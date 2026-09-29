# Base del flujo SDD y trabajo existente

## Problema y resultado esperado

El árbol local incluye la reconstrucción de specs y cambios previos del motor, autenticación, branding y persistencia. Esta ficha formaliza su trazabilidad para la primera revisión conjunta; no atribuye toda esa implementación a la tarea de organización ni certifica reglas tributarias.

## Especificación y decisiones

D-001 a D-005 delimitan observed, RCOF, cancelación v1, permisos admin e idempotencia. D-006 y D-007 siguen bloqueadas externamente. Los cambios previos se revisan contra FEATURES, BUSINESS_RULES y DATA_MODEL; el informe inicial conserva el contexto histórico.

## Criterios de aceptación

- [ ] Observed se consulta por el mismo TrackID y puede finalizar sin retransmisión automática.
- [ ] El RCOF diario persiste una request recuperable con idempotencia estable.
- [ ] Permisos administrativos, links RCOF y carreras de idempotencia quedan definidos y probados.
- [ ] La primera revisión incluye código, migraciones y pruebas preexistentes en el checkout.

## Pruebas y trazabilidad

La ejecución local del 2026-09-27 aprobó 27 suites y 132 tests. Los e2e PostgreSQL fueron omitidos por falta de POSTGRES_E2E_URL; no se afirma validación SII. TESTING.md mantiene resultados y límites. La lista siguiente referencia el inventario real del checkout.

```sdd
{
  "features": [
    "F-01",
    "F-02",
    "F-03",
    "F-04",
    "F-05",
    "F-06",
    "F-07",
    "F-08",
    "F-09",
    "F-10"
  ],
  "specs": [
    "docs/spec/FEATURES.md",
    "docs/spec/API_SPEC.md",
    "docs/spec/BUSINESS_RULES.md",
    "docs/spec/SECURITY.md",
    "docs/spec/DECISIONS.md",
    "docs/spec/DATA_MODEL.md",
    "docs/spec/TRACEABILITY.md",
    "docs/spec/TESTING.md"
  ],
  "code": [
    ".env.example",
    "package-lock.json",
    "scripts/bootstrap-admin.ts",
    "src/application/dte/emit-dte.use-case.ts",
    "src/application/integrations/generate-rcof.use-case.spec.ts",
    "src/application/integrations/generate-rcof.use-case.ts",
    "src/application/integrations/integration-artifacts.service.spec.ts",
    "src/application/integrations/integration-artifacts.service.ts",
    "src/application/integrations/integration-credentials.use-case.spec.ts",
    "src/application/integrations/integration-credentials.use-case.ts",
    "src/application/integrations/integration-errors.ts",
    "src/application/integrations/integration-orchestrator.service.spec.ts",
    "src/application/integrations/integration-orchestrator.service.ts",
    "src/application/integrations/integration-processor.service.spec.ts",
    "src/application/integrations/integration-processor.service.ts",
    "src/application/integrations/integration-request.service.spec.ts",
    "src/application/integrations/integration-request.service.ts",
    "src/application/integrations/integration-webhook.service.spec.ts",
    "src/application/integrations/integration-webhook.service.ts",
    "src/controllers/artifacts.controller.ts",
    "src/controllers/cron.controller.ts",
    "src/controllers/dtes.controller.ts",
    "src/controllers/dtos/create-integration-dte.dto.ts",
    "src/controllers/dtos/emit-dte.dto.ts",
    "src/controllers/dtos/tenant-config.dto.ts",
    "src/controllers/health.controller.ts",
    "src/controllers/integration-controller.helper.ts",
    "src/controllers/tenant-config.controller.ts",
    "src/database/data-source.ts",
    "src/domain/abstracts/data-services.abstract.ts",
    "src/domain/entities/dte-document.entity.ts",
    "src/domain/entities/index.ts",
    "src/domain/entities/integration-credential.entity.ts",
    "src/domain/entities/integration-request.entity.ts",
    "src/infrastructure/decorators/integration-permission.decorator.ts",
    "src/infrastructure/framework/integrations/integration-signature.util.spec.ts",
    "src/infrastructure/framework/integrations/integration-signature.util.ts",
    "src/infrastructure/framework/postgres/b2b-postgres-data-services.module.ts",
    "src/infrastructure/framework/postgres/b2b-postgres-data-services.service.ts",
    "src/infrastructure/framework/postgres/entities/dte-document.entity.ts",
    "src/infrastructure/framework/postgres/entities/index.ts",
    "src/infrastructure/framework/postgres/entities/integration-credential.entity.ts",
    "src/infrastructure/framework/postgres/entities/integration-request.entity.ts",
    "src/infrastructure/framework/sii/discount.engine.ts",
    "src/infrastructure/framework/sii/dte-types.ts",
    "src/infrastructure/framework/sii/dte-xml.engine.ts",
    "src/infrastructure/framework/sii/pdf.generator.spec.ts",
    "src/infrastructure/framework/sii/pdf.generator.ts",
    "src/infrastructure/framework/sii/signature.engine.ts",
    "src/infrastructure/framework/sii/sii-environment.config.ts",
    "src/infrastructure/framework/sii/sii-mock.soap.ts",
    "src/infrastructure/framework/sii/sii-soap.client.ts",
    "src/infrastructure/framework/sii/sii.module.ts",
    "src/infrastructure/framework/sii/tenant-config.service.ts",
    "src/infrastructure/guards/integration-hmac.guard.spec.ts",
    "src/infrastructure/guards/integration-hmac.guard.ts",
    "src/main.ts",
    "test/helpers/fresh-memory-data.service.ts",
    "test/postgres.e2e-spec.ts",
    "docker-compose.yml",
    "scripts/audit-2026-09-19.cjs",
    "scripts/audit-http-2026-09-19.cjs",
    "scripts/audit-xml-2026-09-19.py",
    "src/application/dte/emit-dte.use-case.spec.ts",
    "src/controllers/dtos/discount-percentage.dto.spec.ts",
    "src/controllers/dtos/dte-schema-limits.dto.spec.ts",
    "src/database/migrations/1804900000000-CreateStandaloneTaxBase.ts",
    "src/database/migrations/1805500000000-IntegrationCredentialProtocolV2.ts",
    "src/database/migrations/1805600000000-IntegrationRequestResourceKey.ts",
    "src/database/migrations/1805700000000-InvoiceBrandProfiles.ts",
    "src/database/migrations/1805800000000-AllowSystemIntegrationRequests.ts",
    "src/domain/entities/invoice-brand-profile.entity.ts",
    "src/infrastructure/framework/postgres/entities/invoice-brand-profile.entity.ts",
    "src/infrastructure/framework/sii/discount.engine.precision.spec.ts",
    "src/infrastructure/framework/sii/dte-print.model.spec.ts",
    "src/infrastructure/framework/sii/dte-print.model.ts",
    "src/infrastructure/framework/sii/dte-xml.engine.adjustments.spec.ts",
    "src/infrastructure/framework/sii/invoice-branding.defaults.ts",
    "src/infrastructure/framework/sii/invoice-branding.service.spec.ts",
    "src/infrastructure/framework/sii/invoice-branding.service.ts",
    "src/infrastructure/framework/sii/signature.engine.spec.ts",
    "src/infrastructure/framework/sii/tenant-config.service.branding.spec.ts"
  ],
  "tests": [
    "src/application/dte/emit-dte.use-case.spec.ts",
    "src/application/integrations/generate-rcof.use-case.spec.ts",
    "src/application/integrations/integration-artifacts.service.spec.ts",
    "src/application/integrations/integration-credentials.use-case.spec.ts",
    "src/application/integrations/integration-orchestrator.service.spec.ts",
    "src/application/integrations/integration-processor.service.spec.ts",
    "src/application/integrations/integration-queue.claimer.spec.ts",
    "src/application/integrations/integration-request.service.spec.ts",
    "src/application/integrations/integration-state.service.spec.ts",
    "src/application/integrations/integration-webhook.service.spec.ts",
    "src/controllers/dtos/discount-percentage.dto.spec.ts",
    "src/controllers/dtos/dte-schema-limits.dto.spec.ts",
    "src/controllers/metrics.controller.spec.ts",
    "src/infrastructure/config/runtime-config.spec.ts",
    "src/infrastructure/framework/integrations/integration-signature.util.spec.ts",
    "src/infrastructure/framework/sii/caf.service.spec.ts",
    "src/infrastructure/framework/sii/discount.engine.precision.spec.ts",
    "src/infrastructure/framework/sii/dte-print.model.spec.ts",
    "src/infrastructure/framework/sii/dte-xml.engine.adjustments.spec.ts",
    "src/infrastructure/framework/sii/invoice-branding.service.spec.ts",
    "src/infrastructure/framework/sii/pdf.generator.spec.ts",
    "src/infrastructure/framework/sii/santiago-timezone.util.spec.ts",
    "src/infrastructure/framework/sii/signature.engine.spec.ts",
    "src/infrastructure/framework/sii/sii-soap.client.spec.ts",
    "src/infrastructure/framework/sii/tenant-config.service.branding.spec.ts",
    "src/infrastructure/guards/cron-hmac.guard.spec.ts",
    "src/infrastructure/guards/integration-hmac.guard.spec.ts",
    "test/app-boot.e2e-spec.ts",
    "test/hmac-auth.e2e-spec.ts",
    "test/postgres.e2e-spec.ts",
    "test/runtime-config.e2e-spec.ts"
  ],
  "removed": []
}
```

## Riesgos y responsables

Backend revisa el conjunto y compatibilidad de migraciones. Operaciones confirma PostgreSQL/worker desplegado. El responsable tributario aprueba T46 y evidencia SII. Las firmas, perfiles, migraciones y otras mejoras previas requieren su propia revisión antes de integrarse.
