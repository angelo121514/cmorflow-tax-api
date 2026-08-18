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
- **IntegrationJobPort** — abstracción del worker (cron hoy, BullMQ/pg-boss mañana)
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
2. **Reconciler** (cron cada 5 min vía GitHub Actions) reclama con `FOR UPDATE SKIP LOCKED`
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
| `AUTO_RUN_MIGRATIONS` | `true` en staging, `false` en producción (usar `preDeployCommand`) |

## Desarrollo

```bash
npm install
npm run build
npm test          # 81 specs
npm run start:dev # http://localhost:3000/api/docs
```

## Migraciones

La migración `1805000000000-AddIntegrationsApi` crea las 7 tablas B2B. Depende de que `tenants`, `dte_documents`, `sii_submissions`, `tenant_configs`, `audit_logs` ya existan (tablas del ERP compartidas en el mismo esquema `public`).

```bash
npm run migration:run
```

## Roadmap

- **Fase 6**: OpenAPI drift check propio, `render.yaml` con `preDeployCommand`, CI/cron workflows, rutas limpias (`/dtes`, `/rcof`, `/credentials`, `/webhooks`)
- **Fase 7**: El ERP deja de emitir DTE directamente y consume la Tax API por HTTP. Se elimina el código B2B duplicado del ERP.
- **Futuro**: Separación física de esquema `tax` en Postgres (regla: una tabla = un dueño)

## Documentación

- [Guía de integración](docs/integrations/GUIDE.md) — firma HMAC, verificación de webhooks, reintentos, reconciliación
- [Colección Postman](docs/integrations/cmorapr.postman_collection.json) — pruebas listas

## Origen

Extraído del ERP CmorFlow (`feat/b2b-integrations-api` sobre `staging`/`a808ad4`). La Tax API es el **source of truth** del motor tributario; el ERP pasa a ser un cliente más.

## Licencia

UNLICENSED — CmorFlow 2026