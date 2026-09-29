# CmorFlow Tax API

Plataforma tributaria B2B para facturación electrónica chilena vía API.

**Estado: en desarrollo.** La certificación SII y las decisiones tributarias pendientes se registran en [DECISIONS.md](docs/spec/DECISIONS.md). Para trabajar en el proyecto, empieza por [CONTRIBUTING.md](CONTRIBUTING.md) y el [índice de especificaciones](docs/spec/SPEC_INDEX.md).

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

- **13 entidades** (B2B, DTE, perfiles visuales, SII, tenant, configuración y auditoría) sobre Postgres/Supabase
- **B2BPostgresDataServicesModule** reducido (sin las 49 entidades del ERP)
- **SiiModule** sin `forwardRef` (`Aes256Cipher` movido a `infrastructure/framework/crypto/`)
- **DteEmissionModule** con sólo `EmitDteUseCase` + `QueryDteStatusUseCase`
- **AppModule** sin JWT/SecurityModule/billing/compliance/AI/BullMQ/accounting/RRHH
- **Worker persistente** separado del proceso HTTP, con reclamo atómico y reintentos
- **State machine** de DTE con `ALLOWED_TRANSITIONS`

## Seguridad

- **Autenticación HMAC** por credencial ligada a un único tenant (fail-closed)
- **Credenciales admin vs API**: `cmor_admin_*` (gestión) vs `cmor_live_*` (integradores)
- **9 permisos v1**: `dte:emit`, `dte:read`, `rcof:submit`, `rcof:read`, `artifacts:read`, `webhooks:read`, `webhooks:write`, `credentials:read`, `credentials:write`. Los permisos de credenciales y webhooks son exclusivos de credenciales administrativas.
- **Correlation ID** (`X-Request-ID`) propagado a logs, auditoría y webhooks
- **Anti-lockout**: no revocar la última credencial admin activa del tenant
- **Rate limit** por credencial, nonce antireplay, ventana temporal ±300s
- **Cero dependencia del auth del ERP** (sin JWT, sin bcrypt, sin passport)

## Flujo asíncrono

1. `POST /api/v1/dtes` → valida, recalcula totales, persiste solicitud en `queued`, responde **202** con `requestId`
2. **Worker persistente** reclama con `FOR UPDATE SKIP LOCKED`; GitHub Actions queda sólo como respaldo manual
3. `EmitDteUseCase.prepare` reserva el folio y prepara el DTE; el worker persiste `dteId` antes de transmitir
4. `EmitDteUseCase.transmit` firma el sobre y envía al SII → estado `submitted`
5. **Polling** del estado SII → `accepted` | `observed` | `rejected`; una solicitud `observed` sigue consultando el mismo TrackID sin retransmitir automáticamente
6. **Webhook** firmado notifica la transición (consulta GET es la fuente de verdad)

### Reutilización del documento en reintentos

El `dteId` se persiste tras un `prepare` exitoso. Los reintentos de solicitudes que ya tienen ese vínculo reutilizan el documento. La recuperación ante una caída entre reserva y persistencia del vínculo sigue siendo un escenario a verificar; consulta [TESTING.md](docs/spec/TESTING.md).

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
GET    /api/v1/configuration/branding      → consultar marca activa (admin)
PUT    /api/v1/configuration/branding      → crear/activar marca nueva (admin)
GET    /api/v1/configuration/branding/logo → descargar logo activo (admin)
POST   /api/v1/credentials             → crear (admin)
POST   /api/v1/credentials/:id/rotate  → rotar (admin)
POST   /api/v1/webhooks               → registrar (admin)
GET    /api/v1/health                  → liveness
GET    /api/v1/ready                   → readiness (Postgres + config + crypto)
```

## Configuración

Ver `.env.example` para todas las variables. Las críticas:

| Variable                   | Descripción                                                                      |
| -------------------------- | -------------------------------------------------------------------------------- |
| `DB_HOST` / `DB_SCHEMA`    | Supabase/Postgres. `DB_SCHEMA` parametrizable para futuro esquema `tax` separado |
| `SII_MASTER_KEY`           | Clave AES-256 para cifrar firmas PFX, CAFs y secretos de webhook                 |
| `INTEGRATIONS_API_ENABLED` | Feature flag (true en staging, false en producción hasta gate tributario)        |
| `SII_INTEGRATION_MODE`     | `mock` (desarrollo) o `real` (SII de certificación/producción)                   |
| `INTEGRATION_URL_SECRET`   | Secreto de al menos 32 caracteres para enlaces firmados                          |
| `METRICS_BEARER_TOKEN`     | Token de al menos 32 caracteres para `/api/v1/metrics` en producción             |
| `AUTO_RUN_MIGRATIONS`      | Sólo desarrollo; producción usa `preDeployCommand` y aborta si falla             |

## Desarrollo

Requisitos: Node **22.12 o posterior dentro de la rama 22** y PostgreSQL **16**. `.nvmrc` declara Node 22. Copia `.env.example` a `.env`, genera secretos locales y usa `SII_INTEGRATION_MODE=mock`. La configuración carga `.env` por defecto; puedes cambiar el archivo mediante `SII_ENV_FILE`.

```bash
npm ci
npm run build
npm run migration:run
npm run start:dev # http://localhost:3000/api/docs
```

Para Docker Compose, copia `.env.example` a `.env.local`, genera secretos propios y ejecuta `docker compose up --build`. El conjunto inicia PostgreSQL, aplica las migraciones y levanta procesos separados de API y worker. El modo real exige material tributario y la configuración SII adecuada. El alta del tenant es una precondición; revisa [TENANT_PROVISIONING.md](docs/spec/TENANT_PROVISIONING.md).

### Comprobar un cambio

```bash
npm run repo:check
npm run sdd:test
npm run sdd:check -- --base-ref HEAD --worktree
npm run openapi:check
npm test -- --runInBand
npm run test:e2e -- --runInBand
```

Para validar todo el PR usa su referencia base, por ejemplo `origin/main`, después de `git fetch origin`. Sin `--base-ref`, el checker SDD valida estructura y referencias. Los e2e PostgreSQL necesitan `POSTGRES_E2E_URL` sobre una base desechable; si falta, se omiten. CI ejecuta estas comprobaciones con Node 22 y PostgreSQL 16.

## Migraciones

La migración inicial crea las tablas base cuando se instala de forma independiente. Si se comparte la base con el ERP, usa las tablas existentes sin modificarlas.

```bash
npm run migration:run
```

La migración base rechaza su rollback automático para proteger tablas que podrían ser compartidas con el ERP. Una reversión requiere respaldo y una migración específica revisada para la instalación.

Para crear la primera credencial administrativa de un tenant existente:

```bash
npm run admin:bootstrap -- <TENANT_UUID> "Administrador inicial"
```

El secreto se muestra una sola vez. Después se usa para firmar las solicitudes HMAC descritas en la guía de integración.

## Personalización de facturas

La API administrativa permite configurar logotipo y dos colores para los PDF A4. Cada cambio crea una versión inmutable y los DTE emitidos desde esta migración guardan la versión activa al momento de firmarse; por eso conservan su diseño aunque luego cambie la marca. Los DTE anteriores, que no tenían una versión visual almacenada, se reconstruyen con el diseño neutro basado en su XML firmado. El XML firmado, TED y PDF417 no cambian con la personalización.

Use `PUT /api/v1/configuration/branding` con una credencial `cmor_admin_*` que tenga `credentials:write`. El logo se envía completo en PNG/JPEG base64, se normaliza a PNG y no se obtiene desde URLs externas; el color principal se valida para que el PDF conserve texto legible. La guía de integración contiene el contrato y límites.

## Roadmap

- **SDD y colaboración**: specs, decisiones, referencias verificables y fichas de cambio obligatorias para código/infraestructura en CI
- **Contrato**: OpenAPI con autenticación por operación, respuestas concretas y control de drift
- **Infraestructura**: Blueprint Docker con web y worker persistente; migraciones antes de recibir tráfico
- **Pendiente externo**: desplegar secretos reales y completar formalmente la certificación del SII
- **Fase 7**: El ERP deja de emitir DTE directamente y consume la Tax API por HTTP. Se elimina el código B2B duplicado del ERP.
- **Futuro**: Separación física de esquema `tax` en Postgres (regla: una tabla = un dueño)

## Documentación

- [Guía de integración](docs/integrations/GUIDE.md) — firma HMAC, verificación de webhooks, reintentos, reconciliación
- [Colección Postman](docs/integrations/cmorapr.postman_collection.json) — pruebas listas
- [Mapa de documentación](docs/README.md) e [índice SDD](docs/spec/SPEC_INDEX.md) — features, reglas, contratos, código y pruebas
- [Cómo contribuir](CONTRIBUTING.md) y [plantilla de cambio](docs/spec/CHANGE_TEMPLATE.md) — procedimiento por mejora
- [Changelog](CHANGELOG.md), [reporte de vulnerabilidades](SECURITY.md) y [preparación de versiones](docs/maintainers/RELEASING.md)

## Deploy en Render

`render.yaml` define dos servicios Docker: `cmorflow-tax-api` (HTTP) y `cmorflow-tax-worker` (procesamiento). Ambos usan el mismo grupo secreto. El web ejecuta `node start-migrate.js` como pre-deploy; si la configuración o una migración falla, no abre el puerto. El contenedor incluye `libxml2-utils` para validar XSD.

En una instalación independiente, la migración inicial crea las tablas base; en una instalación compartida, revisa las tablas y el historial antes de aplicar migraciones. Si el servicio existente en Render no usa Docker, el cambio de runtime requiere recrearlo desde el Blueprint.

## Origen

Extraído del ERP CmorFlow (`feat/b2b-integrations-api` sobre `staging`/`a808ad4`). La Tax API es el **source of truth** del motor tributario; el ERP pasa a ser un cliente más.

## Licencia

UNLICENSED — CmorFlow 2026
