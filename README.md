# CmorFlow Tax API

Plataforma tributaria B2B para facturación electrónica chilena vía API.

El ERP, el POS, e-commerce (Shopify, WooCommerce) y cualquier SaaS externo consumen esta API para emitir DTEs, generar RCOF y recibir webhooks — sin necesitar el ERP completo.

```
              CMORFLOW TAX API
                    ▲
          ┌─────────┼─────────┐
          │         │         │
        ERP       POS      terceros
```

## Qué es

Un servicio NestJS autónomo que expone el motor tributario de CmorFlow (emisión de DTE, firma XMLDSig, transmisión al SII, RCOF, artefactos XML/PDF, webhooks salientes) como API REST versionada y autenticada por HMAC. Se puede desplegar independientemente del ERP y vender a otros clientes que sólo necesitan facturación electrónica.

## Arquitectura

- **12 entidades** (7 B2B + DTE/SII submission/tenant/tenant-config/audit-log) sobre Postgres/Supabase
- **B2BPostgresDataServicesModule** reducido (sin las 49 entidades del ERP)
- **SiiModule** sin `forwardRef` (`Aes256Cipher` movido a `infrastructure/framework/crypto/`)
- **DteEmissionModule** con sólo `EmitDteUseCase` + `QueryDteStatusUseCase`
- **AppModule** sin JWT/SecurityModule/billing/compliance/AI/BullMQ/accounting/RRHH
- **Worker persistente** separado del proceso HTTP, con reclamo atómico y reintentos seguros
- **State machine** de DTE con `ALLOWED_TRANSITIONS`

## Seguridad

- **Autenticación HMAC** por credencial ligada a un único tenant (fail-closed)
- **Credenciales admin vs API**: `cmor_admin_*` (gestión) vs `cmor_live_*` (integradores)
- **10 permisos**: `dte:emit`, `dte:read`, `dte:cancel`, `rcof:submit`, `rcof:read`, `artifacts:read`, `webhooks:read`, `webhooks:write`, `credentials:read`, `credentials:write`
- **Correlation ID** (`X-Request-ID`) propagado a logs, auditoría y webhooks
- **Anti-lockout**: no revocar la última credencial admin activa del tenant
- **Rate limit** por credencial, nonce antireplay, ventana temporal ±300s
- **Cero dependencia del auth del ERP** (sin JWT, sin bcrypt, sin passport)

## Flujo asíncrono

1. `POST /api/v1/dtes` → valida, recalcula totales, persiste solicitud en `queued`, responde **202** con `requestId`
2. **Worker persistente** reclama con `FOR UPDATE SKIP LOCKED`; GitHub Actions queda sólo como respaldo manual
3. `EmitDteUseCase.prepare` reserva folio **una sola vez** (persiste `dteId` antes de transmitir)
4. `EmitDteUseCase.transmit` firma el sobre y envía al SII → estado `submitted`
5. **Polling** del estado SII → `accepted` | `observed` | `rejected`
6. **Webhook** firmado notifica la transición (consulta GET es la fuente de verdad)

### Garantía de folio único

El `dteId` se persiste tras el primer `prepare` exitoso. Los reintentos reutilizan ese documento y jamás reservan un segundo folio.

## Endpoints principales

```
POST   /api/v1/dtes                    → emitir DTE (202)
GET    /api/v1/dtes/:id                → estado
GET    /api/v1/dtes?externalReference=  → reconciliar
GET    /api/v1/dtes/:id/xml            → artefacto XML
GET    /api/v1/dtes/:id/pdf            → artefacto PDF
POST   /api/v1/dtes/:id/artifact-links → URL firmadas
POST   /api/v1/dtes/:id/credit-notes   → nota crédito
POST   /api/v1/dtes/:id/debit-notes    → nota débito
POST   /api/v1/rcof                    → RCOF
GET    /api/v1/rcof/:id               → estado RCOF
POST   /api/v1/configuration/caf      → cargar CAF cifrado (admin)
POST   /api/v1/configuration/signature → cargar certificado PFX cifrado (admin)
GET    /api/v1/configuration/folios   → consultar disponibilidad (admin)
POST   /api/v1/credentials             → crear (admin)
POST   /api/v1/credentials/:id/rotate  → rotar (admin)
POST   /api/v1/webhooks               → registrar (admin)
GET    /api/v1/health                  → liveness
GET    /api/v1/ready                   → readiness (Postgres + config + crypto)
```

## Configuración

Ver `.env.example` para todas las variables. Las críticas:

| Variable | Descripción |
|---|---|
| `DB_HOST` / `DB_SCHEMA` | Supabase/Postgres. `DB_SCHEMA` parametrizable para futuro esquema `tax` separado |
| `SII_MASTER_KEY` | Clave AES-256 para cifrar firmas PFX, CAFs y secretos de webhook |
| `INTEGRATIONS_API_ENABLED` | Feature flag (true en staging, false en producción hasta gate tributario) |
| `SII_INTEGRATION_MODE` | `mock` (desarrollo) o `real` (SII de certificación/producción) |
| `INTEGRATION_URL_SECRET` | Secreto de al menos 32 caracteres para enlaces firmados |
| `METRICS_BEARER_TOKEN` | Token de al menos 32 caracteres para `/api/v1/metrics` en producción |
| `AUTO_RUN_MIGRATIONS` | Sólo desarrollo; producción usa `preDeployCommand` y aborta si falla |

## Desarrollo

```bash
npm install
npm run build
npm test
npm run test:e2e
npm run start:dev # http://localhost:3000/api/docs
```

## Migraciones

La migración `1805000000000-AddIntegrationsApi` crea las 7 tablas B2B. Depende de que `tenants`, `dte_documents`, `sii_submissions`, `tenant_configs`, `audit_logs` ya existan (tablas del ERP compartidas en el mismo esquema `public`).

```bash
npm run migration:run
```

Para crear la primera credencial administrativa de un tenant existente:

```bash
npm run admin:bootstrap -- <TENANT_UUID> "Administrador inicial"
```

El secreto se muestra una sola vez. Después se usa para firmar las solicitudes HMAC descritas en la guía de integración.

## Roadmap

- **Fase 6** ✅: OpenAPI drift check propio, `render.yaml`, CI/cron workflows, rutas limpias (`/dtes`, `/rcof`, `/credentials`, `/webhooks`)
- **Infraestructura**: Blueprint Docker con web y worker persistente; migraciones antes de recibir tráfico
- **Pendiente externo**: desplegar secretos reales y completar formalmente la certificación del SII
- **Fase 7**: El ERP deja de emitir DTE directamente y consume la Tax API por HTTP. Se elimina el código B2B duplicado del ERP.
- **Futuro**: Separación física de esquema `tax` en Postgres (regla: una tabla = un dueño)

## Documentación

- [Guía de integración](docs/integrations/GUIDE.md) — firma HMAC, verificación de webhooks, reintentos, reconciliación
- [Colección Postman](docs/integrations/cmorapr.postman_collection.json) — pruebas listas

## Deploy en Render

`render.yaml` define dos servicios Docker: `cmorflow-tax-api` (HTTP) y `cmorflow-tax-worker` (procesamiento). Ambos usan el mismo grupo secreto. El web ejecuta `node start-migrate.js` como pre-deploy; si la configuración o una migración falla, no abre el puerto. El contenedor incluye `libxml2-utils` para validar XSD.

En una instalación nueva se deben crear primero las tablas base compartidas del ERP indicadas en la sección Migraciones. Si el servicio existente en Render no usa Docker, el cambio de runtime requiere recrearlo desde el Blueprint.

## Origen

Extraído del ERP CmorFlow (`feat/b2b-integrations-api` sobre `staging`/`a808ad4`). La Tax API es el **source of truth** del motor tributario; el ERP pasa a ser un cliente más.

## Licencia

UNLICENSED — CmorFlow 2026
