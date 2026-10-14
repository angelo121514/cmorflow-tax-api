# Corrección de seguridad, recursos y recuperación

## Problema y resultado esperado

El gate de dependencias impedía integrar MIT/SDD. Configuraciones obsoletas podían perder reservas, prepare/vínculo no eran atómicos y los eventos se creaban después del estado. Se corrigen esos fallos y se sustituye distribución de recursos sin permiso documentado por provisión externa.

## Especificación y decisiones

Se mantienen F-xx/BR-xx/D-xxx. D-006 sigue bloqueada; D-007 admite CLI sólo para base independiente. Nueva migración conserva marcador de envío antes de red; una ambigüedad requiere conciliación y no reenvío automático. No se promete exactly-once externo. La outbox usa eventos/entregas existentes, dentro de la transacción de estado.

## Criterios de aceptación

- [x] Audit de producción sin avisos y sin apagar gates.
- [x] Caída tras reserva, documento o vínculo revierte todo y recupera sin otro folio confirmado.
- [x] Escrituras administrativas y recarga CAF preservan contador y rechazan solapamiento.
- [x] Fallo al guardar entrega revierte estado/evento; transición concurrente crea una sola notificación durable.
- [x] Firma nativa verificable, tamper rechazado y contraseña PFX incorrecta rechazada.
- [x] Recursos inciertos ausentes de distribución; procedimiento externo mantiene TLS/XSD.
- [x] Provisioning independiente validado y atómico; límites SII/ERP explícitos.

## Pruebas y trazabilidad

E2e PostgreSQL independiente crea una base efímera para fallos/transacciones; prueba servicios reales y repositorios, con preparador y transporte externos controlados. Unitarios verifican firma y cuarentena; CI ejecuta Node 22, DB16 y Docker. VALIDATION_REPORT registra resultados y omisiones reales.

```sdd
{
  "features": [
    "F-01",
    "F-06",
    "F-07",
    "F-08",
    "F-10"
  ],
  "specs": [
    "docs/spec/BUSINESS_RULES.md",
    "docs/spec/DATA_MODEL.md",
    "docs/spec/TENANT_PROVISIONING.md",
    "docs/spec/SII_CERTIFICATION_CHECKLIST.md",
    "docs/spec/TASKS.md",
    "docs/spec/VALIDATION_REPORT.md"
  ],
  "code": [
    ".dockerignore",
    ".env.example",
    ".github/workflows/ci.yml",
    ".gitignore",
    "CHANGELOG.md",
    "Dockerfile",
    "README.md",
    "THIRD_PARTY_NOTICES.md",
    "certs/README.md",
    "docs/spec/BUSINESS_RULES.md",
    "docs/spec/DATA_MODEL.md",
    "docs/spec/DECISIONS.md",
    "docs/spec/IMPLEMENTATION_STATUS.md",
    "docs/spec/SII_CERTIFICATION_CHECKLIST.md",
    "docs/spec/TASKS.md",
    "docs/spec/TECHNICAL_DEBT.md",
    "docs/spec/TENANT_PROVISIONING.md",
    "docs/spec/TESTING.md",
    "docs/spec/VALIDATION_REPORT.md",
    "package-lock.json",
    "package.json",
    "scripts/bootstrap-admin.ts",
    "scripts/provision-tenant.ts",
    "src/application/integrations/integration-processor.service.spec.ts",
    "src/application/integrations/integration-processor.service.ts",
    "src/application/integrations/integration-queue.claimer.ts",
    "src/application/integrations/integration-state.service.ts",
    "src/application/integrations/tenant-provisioning.ts",
    "src/database/migrations/1805900000000-TransmissionRecoveryFence.ts",
    "src/domain/entities/integration-request.entity.ts",
    "src/infrastructure/framework/postgres/entities/integration-request.entity.ts",
    "src/infrastructure/framework/postgres/postgres-generic-repository.ts",
    "src/infrastructure/framework/postgres/tenant-transaction.ts",
    "src/infrastructure/framework/sii/caf.service.ts",
    "src/infrastructure/framework/sii/certificate.utils.spec.ts",
    "src/infrastructure/framework/sii/certificate.utils.ts",
    "src/infrastructure/framework/sii/dte-types.ts",
    "src/infrastructure/framework/sii/dte-xml.engine.adjustments.spec.ts",
    "src/infrastructure/framework/sii/dte-xml.engine.ts",
    "src/infrastructure/framework/sii/signature.engine.ts",
    "src/infrastructure/framework/sii/sii-mock.soap.ts",
    "src/infrastructure/framework/sii/sii-xsd.validator.ts",
    "src/infrastructure/framework/sii/tenant-config.service.branding.spec.ts",
    "src/infrastructure/framework/sii/tenant-config.service.ts",
    "src/infrastructure/framework/sii/xsd/README.md",
    "test/postgres.e2e-spec.ts",
    "test/reliability.e2e-spec.ts"
  ],
  "tests": [
    "src/application/integrations/integration-processor.service.spec.ts",
    "src/infrastructure/framework/sii/certificate.utils.spec.ts",
    "src/infrastructure/framework/sii/dte-xml.engine.adjustments.spec.ts",
    "src/infrastructure/framework/sii/tenant-config.service.branding.spec.ts",
    "test/postgres.e2e-spec.ts",
    "test/reliability.e2e-spec.ts"
  ],
  "removed": [
    "certs/supabase-root-ca.crt",
    "src/infrastructure/framework/sii/xsd/CAF_v10.xsd",
    "src/infrastructure/framework/sii/xsd/ConsumoFolio_v10.xsd",
    "src/infrastructure/framework/sii/xsd/EnvioBOLETA_v11.xsd",
    "src/infrastructure/framework/sii/xsd/EnvioDTE_v10.xsd",
    "src/infrastructure/framework/sii/xsd/LceCal_v10.xsd",
    "src/infrastructure/framework/sii/xsd/LceCoCertif_v10.xsd",
    "src/infrastructure/framework/sii/xsd/LceSiiTypes_v10.xsd",
    "src/infrastructure/framework/sii/xsd/LibroCV_v10.xsd"
  ]
}
```

## Riesgos y responsables

Backend mantiene preparación, marker/outbox y compatibilidad de crypto. Operaciones aplica migración antes del worker y monta esquemas/CA propios antes de actualizar; no se despliega esta tarea. El rollback automático del marcador se rechaza. Mantenedor conserva avisos W3C e identifica que copias históricas no se relicencian. Tributario/SII valida T46 y certificación; no se cierran con mocks.
