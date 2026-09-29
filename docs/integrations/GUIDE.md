# Guía de integración B2B — CmorFlow Tax API

CmorFlow Tax API es la **plataforma tributaria central** de CmorFlow: facturación electrónica chilena vía API. El ERP, el POS, e-commerce (Shopify, WooCommerce) y cualquier SaaS externo consumen esta API para emitir DTEs, generar RCOF y recibir webhooks — sin necesitar el ERP.

**URL base (Render staging):** `https://cmorflow-tax-api.onrender.com/api/v1`

## Resumen del flujo

1. **Autenticación HMAC** por credencial ligada a un único tenant.
2. **Emisión asíncrona**: `POST /dtes` responde `202` con un `requestId`.
3. **Consulta de estado**: `GET /dtes/:id` es la fuente de verdad.
4. **Webhooks**: notificaciones firmadas opcionales; la consulta es el respaldo.
5. **Artefactos**: XML y PDF vía descarga autenticada o URL firmada de corta duración.

## Tipos de credencial

| Tipo | Prefijo keyId | Uso | Permisos |
|---|---|---|---|
| **API** | `cmor_live_*` | Integradores (Shopify, ERP, POS) | `dte:emit`, `dte:read`, `artifacts:read`, `rcof:submit`, `rcof:read` |
| **Admin** | `cmor_admin_*` | Gestión de la cuenta y configuración tributaria/visual | `credentials:read`, `credentials:write`, `webhooks:read`, `webhooks:write` |

Una credencial de API **no puede** tener permisos administrativos, incluidos `webhooks:read` y `webhooks:write`. Así, una integración de Shopify comprometida no puede consultar entregas ni administrar endpoints de webhook.

## Permisos

```
dte:emit          Emitir DTE y notas
dte:read          Consultar estado
rcof:submit       Generar/transmitir RCOF
rcof:read         Consultar RCOF
artifacts:read    Descargar XML/PDF + URL firmadas
webhooks:read     Listar endpoints y entregas
webhooks:write    Registrar/desactivar endpoints
credentials:read  Listar credenciales
credentials:write Crear/rotar/revocar credenciales
```

`dte:cancel` no es un permiso aceptado en la API v1: no existe una ruta de cancelación validada. No lo solicites al crear credenciales.

## 1. Autenticación HMAC

Cada petición debe incluir cuatro encabezados:

| Header | Descripción |
|---|---|
| `X-Api-Key` | Identificador público de la credencial (`cmor_live_…`). |
| `X-Timestamp` | Epoch en segundos (ventana ±300s). |
| `X-Nonce` | UUID único por petición dentro de la ventana. |
| `X-Signature` | HMAC-SHA256 hex del string canónico. |

### String canónico

```
METHOD\n<ruta con query>\n<sha256(body)>\n<timestamp>\n<nonce>
```

- `METHOD`: HTTP method en mayúsculas (`POST`, `GET`).
- `<ruta con query>`: la ruta original de la petición, incluido query string (ej. `/api/v1/dtes?externalReference=APR-1`).
- `<sha256(body)>`: SHA-256 hex del body crudo. Body vacío → hash de cadena vacía.
- `<timestamp>`: el mismo valor de `X-Timestamp`.
- `<nonce>`: el mismo valor de `X-Nonce`.

### Clave de firma

Las credenciales nuevas usan el valor `cmc_…` original como clave HMAC. Guárdalo en el gestor de secretos del integrador: el servidor lo cifra en reposo y sólo lo descifra para verificar la firma. Las claves creadas antes de esta actualización permanecen temporalmente en protocolo v1 (`sha256hex(secreto)`); rótalas para pasar a v2.

### Ejemplo en TypeScript

```typescript
import { createHash, createHmac, randomUUID } from 'crypto';

const apiKey = 'cmor_live_xxx';
const secret = 'cmc_xxx'; // guardado de forma segura en el integrador
const signingKey = secret; // protocolo v2

function signRequest(method: string, pathWithQuery: string, body: Buffer) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = randomUUID();
  const bodyHash = createHash('sha256').update(body).digest('hex');
  const canonical = [method.toUpperCase(), pathWithQuery, bodyHash, timestamp, nonce].join('\n');
  const signature = createHmac('sha256', signingKey).update(canonical).digest('hex');
  return {
    'X-Api-Key': apiKey,
    'X-Timestamp': timestamp,
    'X-Nonce': nonce,
    'X-Signature': signature,
  };
}

// Ejemplo: emitir una boleta afecta
const body = Buffer.from(JSON.stringify({
  documentType: 39,
  items: [{ name: 'Consumo de agua - Julio 2026', quantity: 1, unitPrice: 45000 }],
  externalReference: 'APR-CONSUMO-88021',
  metadata: { periodoApr: '2026-07', numeroCuenta: 'CTA-88021' },
}));
const headers = {
  ...signRequest('POST', '/api/v1/dtes', body),
  'Content-Type': 'application/json',
  'Idempotency-Key': randomUUID(),
};
const response = await fetch('https://api.cmorflow.cl/api/v1/dtes', {
  method: 'POST',
  headers,
  body,
});
// → 202 { requestId, status: 'queued', _links: { self: '/api/v1/dtes/{requestId}' } }
```

### Ejemplo en curl

```bash
API_KEY="cmor_live_xxx"
SECRET="cmc_xxx"
TIMESTAMP=$(date +%s)
NONCE=$(uuidgen)
BODY='{"documentType":39,"items":[{"name":"Consumo agua","quantity":1,"unitPrice":45000}],"externalReference":"APR-1"}'
BODY_HASH=$(echo -n "$BODY" | sha256sum | awk '{print $1}')
CANONICAL="POST\n/api/v1/dtes\n${BODY_HASH}\n${TIMESTAMP}\n${NONCE}"
SIGNATURE=$(printf "%b" "$CANONICAL" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')

curl -X POST https://api.cmorflow.cl/api/v1/dtes \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: ${API_KEY}" \
  -H "X-Timestamp: ${TIMESTAMP}" \
  -H "X-Nonce: ${NONCE}" \
  -H "X-Signature: ${SIGNATURE}" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d "$BODY"
```

## 2. Emisión de DTE

### `POST /dtes`

Requiere `Idempotency-Key` no vacía. Es una cadena opaca: el servidor conserva su valor y no exige formato UUID. PostgreSQL no impone una longitud de columna; aplica el límite del servidor HTTP para headers. Responde `202` con `requestId` y estado inicial `queued`.

- Misma key + mismo body → misma respuesta (replay seguro).
- Misma key + body distinto → `409 IDEMPOTENCY_CONFLICT`.
- `externalReference` repetida con otra key → `409 EXTERNAL_REFERENCE_CONFLICT`.
- Claves con sólo espacios se rechazan. Usa claves distintas para recursos/operaciones distintas.

El servidor **recalcula y valida los totales** (IVA 19%, descuentos, redondeo CLP). Si `totals` se declara y no coincide (tolerancia $1) → `422 TOTALS_MISMATCH`.

### Tipos soportados

| Tipo | Documento | Notas |
|---|---|---|
| 33 | Factura electrónica | Receptor obligatorio. |
| 34 | Factura exenta | Todos los ítems `exempt: true`. |
| 39 | Boleta electrónica afecta | Receptor opcional. Sin ítems exentos. |
| 41 | Boleta electrónica exenta | Receptor opcional. Todos los ítems exentos. |
| 46 | Factura de compra | Requiere autorización especial del SII. |
| 52 | Guía de despacho | Requiere `transport.transferType`. |

Las notas de crédito (61) y débito (56) se emiten vía `POST /dtes/:dteId/credit-notes` y `/debit-notes` respectivamente.

## 3. Consulta de estado

### `GET /dtes/:requestId`

Devuelve el estado consolidado: estado público, folio, TrackID, estado SII, errores normalizados y timestamps.

### `GET /dtes?externalReference=...`

Reconcilia una operación por su referencia externa de negocio.

### Estados públicos

`queued` → `processing` → `submitted` → `accepted` | `observed` | `rejected` | `failed` | `cancelled`

- `observed` = SII responde con REPARO (requiere corrección).
- El reconciliador sigue consultando el TrackID de solicitudes `observed`; no retransmite el documento. Si SII publica un estado posterior, la solicitud pasa a `accepted` o `rejected`.

## RCOF diario

El worker encola el RCOF diario como una solicitud persistida, con clave estable por fecha y secuencia. El trabajo sobrevive reinicios; usa `GET /api/v1/rcof/:requestId` para consultar el estado. El mismo RCOF no se encola dos veces para un tenant/fecha/secuencia.

## Alta de tenant

La API no crea tenants ni guarda el perfil tributario inicial. El aprovisionamiento se completa fuera de este servicio antes de emitir: un operador autorizado debe registrar el tenant, asociar su configuración tributaria y credenciales de emisión, y comprobar CAF/PFX y datos requeridos en ambiente de certificación. El procedimiento y responsable externo pendiente están detallados en `docs/spec/TENANT_PROVISIONING.md`; no uses inserciones SQL manuales no aprobadas.
- `failed` = reintentos agotados por fallos recuperables.
- `cancelled` = documento anulado.

## 4. Artefactos (XML y PDF)

### Descarga autenticada

```
GET /dtes/:dteId/xml   (permiso artifacts:read)
GET /dtes/:dteId/pdf   (permiso artifacts:read)
```

### URL firmada de corta duración

```
POST /dtes/:dteId/artifact-links
→ { xmlUrl, pdfUrl, expiresAt }
```

El token es válido 5 minutos. Descarga sin headers HMAC:

```
GET /artifacts/:token
```

Los artefactos **nunca** se sirven desde buckets públicos.

## 5. Webhooks

### Registro (API administrativa con HMAC)

Registrar un endpoint HTTPS con una credencial `admin` HMAC y permiso `webhooks:write`. `webhooks:read` también es exclusivo de credenciales admin. El secreto de firma se muestra una sola vez.

### Firma de cada entrega

```
X-CmorFlow-Signature: sha256=HMAC(secreto, timestamp + '.' + body)
X-CmorFlow-Event-Id: <uuid>
X-CmorFlow-Event-Type: dte.accepted
X-CmorFlow-Timestamp: <epoch segundos>
```

### Verificación lado consumidor

```typescript
const signature = headers['x-cmorflow-signature']; // 'sha256=...'
const timestamp = headers['x-cmorflow-timestamp'];
const expected = 'sha256=' + createHmac('sha256', webhookSecret)
  .update(timestamp + '.' + rawBody).digest('hex');
if (signature !== expected) return res.status(401).end();
```

### Eventos

| Evento | Descripción |
|---|---|
| `dte.submitted` | DTE transmitido al SII (TrackID asignado). |
| `dte.accepted` | SII acepta el documento. |
| `dte.observed` | SII responde con reparo. |
| `dte.rejected` | SII rechaza el documento. |
| `dte.failed` | Reintentos agotados. |
| `rcof.submitted` | RCOF transmitido al SII. |
| `rcof.accepted` | SII acepta el RCOF. |
| `rcof.rejected` | SII rechaza el RCOF. |

### Reintentos y reconciliación

- Entregas fallidas se reintentan con backoff (1m, 5m, 15m, 30m, 1h, 6h) hasta 6 intentos.
- Las entregas pueden llegar **fuera de orden**. La consulta `GET` es la fuente de verdad.
- Reenvío manual disponible vía API administrativa.

## 6. RCOF (Consumo de Folios)

### `POST /rcof`

```
{ "date": "2026-08-14", "sequenceNumber": 1 }
```

Idempotente por (tenant, fecha, secuencia). Consolida boletas 39/41 del día (incluye folios anulados), firma, persiste y transmite al SII.

### `GET /rcof/:id`

Estado del RCOF: estado, TrackID, respuesta SII.

### Generación diaria automática

El sistema genera automáticamente el RCOF del día anterior (zona `America/Santiago`) para cada tenant con boletas. La solicitud manual está disponible para recuperación.

## 7. Catálogo de errores

| Código | HTTP | Descripción |
|---|---|---|
| `API_DISABLED` | 404 | API deshabilitada en este ambiente. |
| `MISSING_HEADERS` | 401 | Faltan headers HMAC. |
| `UNKNOWN_KEY` | 401 | Credencial desconocida. |
| `CREDENTIAL_REVOKED` | 401 | Credencial revocada. |
| `CREDENTIAL_EXPIRED` | 401 | Credencial expirada. |
| `TIMESTAMP_OUT_OF_WINDOW` | 401 | Timestamp fuera de ventana ±300s. |
| `INVALID_SIGNATURE` | 401 | Firma HMAC inválida. |
| `NONCE_REPLAYED` | 401 | Nonce ya utilizado (replay). |
| `RATE_LIMITED` | 429 | Rate limit de la credencial excedido. |
| `PERMISSION_DENIED` | 403 | La credencial no tiene los permisos requeridos. |
| `TENANT_MISMATCH` | 403 | x-tenant-id no coincide con la credencial. |
| `IDEMPOTENCY_KEY_REQUIRED` | 400 | Falta Idempotency-Key. |
| `IDEMPOTENCY_CONFLICT` | 409 | Key reusada con body distinto. |
| `EXTERNAL_REFERENCE_CONFLICT` | 409 | externalReference ya usada. |
| `VALIDATION_ERROR` | 422 | Validación tributaria fallida. |
| `TOTALS_MISMATCH` | 422 | Totales declarados no coinciden. |
| `FOLIO_EXHAUSTED` | — | Folios agotados para el tipo. |
| `SII_REJECTED` | — | Rechazo tributario definitivo del SII. |
| `SII_UNAVAILABLE` | — | Indisponibilidad/timeout del SII (recuperable). |
| `NOT_FOUND` | 404 | Recurso no encontrado para esta credencial. |

## 8. Personalización de facturas A4

Los endpoints de configuración usan una credencial administrativa HMAC (`cmor_admin_*`). No existe una vista previa: cada `PUT` crea y activa una versión completa de marca.

```
GET /configuration/branding       (credentials:read)
PUT /configuration/branding       (credentials:write)
GET /configuration/branding/logo  (credentials:read)
```

### Crear una versión de marca

```json
{
  "logo": {
    "mimeType": "image/png",
    "base64": "iVBORw0KGgo..."
  },
  "primaryColor": "#1F4B99",
  "secondaryColor": "#5B8DEF"
}
```

- `logo` debe estar presente en cada `PUT`. Use `null` para una versión sin logo.
- Se aceptan solamente PNG o JPEG en base64 estándar. SVG, URLs remotas, imágenes animadas y prefijos `data:` se rechazan.
- El archivo de entrada puede pesar hasta 700 KB y hasta 4 megapíxeles; el servidor elimina metadatos, limita dimensiones y almacena una versión PNG de hasta 512 KB.
- `primaryColor` debe conservar contraste suficiente con texto blanco para que las tablas del PDF sigan siendo legibles al imprimir.
- La respuesta no incluye el base64: devuelve versión, colores, hash y tamaño. Use `GET /configuration/branding/logo` para obtener el PNG activo.
- Al firmar un DTE, se guarda el identificador de la versión activa. Los DTE emitidos desde esta migración se regeneran con esa misma versión, aunque luego cambie el logo o los colores. Los documentos anteriores no tenían una versión visual almacenada y se reconstruyen con el diseño neutro basado en su XML firmado.
- La marca sólo afecta la representación gráfica A4. El XML firmado, sus totales, TED y PDF417 no se modifican.

Ejemplo de respuesta de `GET /configuration/branding`:

```json
{
  "configured": true,
  "version": 3,
  "primaryColor": "#1F4B99",
  "secondaryColor": "#5B8DEF",
  "logo": {
    "mimeType": "image/png",
    "sha256": "e3b0c44298fc1c149afbf4c8996fb924...",
    "bytes": 18432
  },
  "createdAt": "2026-09-20T15:12:45.000Z"
}
```

## 9. Administración por API HMAC

Los endpoints administrativos requieren una credencial `cmor_admin_*` con los permisos indicados:

- `POST /credentials` — crear credencial (secreto una sola vez).
- `GET /credentials` — listar enmascaradas.
- `POST /credentials/:id/rotate` — rotar (24h de gracia).
- `POST /credentials/:id/revoke` — revocar.
- `POST /webhooks` — registrar endpoint.
- `GET /webhooks` — listar endpoints.
- `POST /webhooks/:id/deactivate` — desactivar.
- `POST /webhooks/events/:eventId/redeliver` — reenviar evento.
- `GET /webhooks/deliveries` — historial de entregas.
- `GET /configuration/branding` — consultar la marca activa.
- `PUT /configuration/branding` — crear y activar una versión de marca.
- `GET /configuration/branding/logo` — descargar el logo activo.

## 10. Consideraciones operacionales

- **Latencia**: la emisión es asíncrona. El `202` es inmediato; el estado `submitted` (con TrackID) puede tardar segundos a minutos según la disponibilidad del SII.
- **Reconciler**: un cron cada 5 minutos procesa la cola, consulta el SII y entrega webhooks. La BD es la fuente de verdad: tras cualquier reinicio, el reconciler retoma todo.
- **Rate limit**: 60 solicitudes por minuto por credencial (configurable).
- **Feature flag**: `INTEGRATIONS_API_ENABLED=true` en staging; `false` en producción hasta completar el gate tributario.
- **Staging vs producción**: la primera versión se activa en staging con una credencial exclusiva para CMORAPR. Producción permanece deshabilitada hasta completar la verificación de boletas 39/41 y RCOF.
