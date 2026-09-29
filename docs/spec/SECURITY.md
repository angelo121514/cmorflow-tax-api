# Seguridad observada

## Autenticación y autorización

- API B2B usa HMAC-SHA256 y headers X-Api-Key, X-Timestamp, X-Nonce y X-Signature; ventana default 300 segundos.
- String canónico incluye método, ruta original+query, SHA-256 del body crudo, timestamp y nonce; comparación de firma segura.
- Credencial se busca por keyId y puede estar revocada/expirada. Nuevas credenciales guardan secreto cifrado AES-256-GCM y signing_version v2; v2 usa secreto descifrado como clave HMAC. Legacy sin cifrado sigue protocolo heredado.
- Nonce se guarda por credential_id+nonce con expiry; constraint unique protege carreras. Reconciliador purga expirados.
- Rate limit HMAC se aplica tras verificar firma: default 60/minuto por credencial, en mapa de memoria. Throttler global Nest: 120/minuto por IP.
- Permisos en handlers: dte:emit/read, artifacts:read, rcof:_, credentials:_ y webhooks:*.
- Tenant se obtiene exclusivamente de credencial; X-Tenant-Id contradictorio se rechaza. Repository/RLS aplican aislamiento.
- Rutas internas cron usan otro HMAC, timestamp ±300 s y nonce persistido en cron_nonces.
- En producción las métricas exigen METRICS_ENABLED=true y bearer token.

No se encontró JWT en AppModule. La guía ahora describe el contrato implementado: registro de webhook por HMAC con permiso `webhooks:write` y credencial admin.

## Secretos y criptografía

- Producción valida SII_MASTER_KEY de al menos 32 caracteres y distinta del default.
- Material PFX/password, CAF y secreto webhook se cifra con AES-256-GCM, scrypt, IV de 12 bytes y salt aleatorio; conserva compatibilidad con material legacy sin salt.
- Firma XMLDSig usa xml-crypto con C14N, RSA-SHA1 y SHA1, según código; compatibilidad requerida por SII vigente: **requiere validación externa**.
- Enlace de artefacto usa HMAC con INTEGRATION_URL_SECRET y TTL de 300 s; descarga pública depende de validar firma/expiración.
- Secreto de credencial y webhook se muestra al crearlos y no se vuelve a exponer al listarlos.

## Validación/superficie HTTP

Una credencial v2 sin secreto cifrado se rechaza con 401/INVALID_SIGNATURE: nunca degrada automáticamente al protocolo v1 aunque tenga secretHash.

ValidationPipe rechaza propiedades desconocidas y transforma DTOs; validación RUT para receptor y límites de detalle/logo. Helmet activo; CSP desactivado al servir Swagger. CORS usa CORS_ORIGINS; origen no permitido no recibe headers CORS. Body default 1 MB. Proxy trust a un salto.

La ruta /artifacts/:token es pública por diseño, autorizada mediante token firmado; no se observó bucket público.

## Aislamiento multi-tenant

Repositories scoped requieren CLS tenant, filtran tenant_id y establecen app.tenant_id dentro de transacción. RLS usa tenant setting y permite worker_scope controlado. Credentials/nonces y enumeración de tenants son globales por diseño. invoice_brand_profiles tiene FK compuesta perfil/tenant; DTE fija snapshot inmutable.

## Riesgos y diferencias observadas

- Rate limit por credencial en memoria no se comparte entre réplicas y se reinicia al arrancar.
- La creación de credencial tipo API bloquea credentials:read/write y webhooks:read/write; la política coincide con GUIDE.md.
- `dte:cancel` no forma parte de permisos v1 mientras no exista una ruta/flujo aprobados.
- OpenAPI declara los cuatro headers HMAC y permission scopes por operación; rutas públicas y tokenizadas declaran security vacío explícito.
- La entrega webhook conserva el timeout durante el body y sólo lee un snippet máximo de 300 bytes.
- No existe provisioning HTTP; los requisitos se documentan en TENANT_PROVISIONING.md, pero falta un runbook con sistema fuente y responsable aprobado.
- Validación XSD es condicional y usa rutas de schema configurables; aceptación del conjunto incluido contra esquema oficial actual no está demostrada.

No es una prueba de penetración. No se consultaron secretos, ambiente remoto, roles PostgreSQL ni configuración desplegada.
