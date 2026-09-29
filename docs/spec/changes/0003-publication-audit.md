# Auditoría previa a subir el proyecto

## Problema y resultado esperado

Revisar el árbol completo antes de confirmarlo y publicar los cambios autorizados. Corregir fallos concretos detectados, conservar evidencia de checks y distinguir límites externos.

## Especificación y decisiones

Se recuperan resultados RCOF persistidos antes de consolidar la request. Una credencial v2 sin secreto cifrado falla sin degradar a v1. La migración base usa timestamp válido y rechaza rollback destructivo sobre tablas cuyo origen puede ser el ERP. Se actualizan parches de dependencias compatibles; la licencia queda pendiente.

## Criterios de aceptación

- [x] Una request submitted recupera un RCOF accepted/rejected guardado sin volver a consultar o transmitir.
- [x] TypeORM acepta y ordena la migración base antes del esquema B2B; su rollback no emite DROP.
- [x] La firma v2 basada en hash se rechaza aunque el registro no tenga secreto cifrado.
- [x] La suite, contrato y trazabilidad pasan y se revisan posibles secretos antes del push.

## Pruebas y trazabilidad

Las regresiones están en integration-processor.service.spec.ts, integration-hmac.guard.spec.ts y standalone-migration.spec.ts. TESTING.md y el informe de auditoría registran los resultados locales y el enlace de CI cuando esté disponible.

```sdd
{
  "features": [
    "F-03",
    "F-05",
    "F-07",
    "F-10"
  ],
  "specs": [
    "docs/spec/FEATURES.md",
    "docs/spec/DATA_MODEL.md",
    "docs/spec/SECURITY.md",
    "docs/spec/TESTING.md"
  ],
  "code": [
    "scripts/check-sdd-traceability.cjs",
    "test/scripts/sdd-traceability.test.cjs",
    "src/application/integrations/integration-processor.service.ts",
    "src/application/integrations/integration-processor.service.spec.ts",
    "src/application/integrations/integration-request.service.spec.ts",
    "src/infrastructure/guards/integration-hmac.guard.ts",
    "src/infrastructure/guards/integration-hmac.guard.spec.ts",
    "src/database/migrations/1804900000000-CreateStandaloneTaxBase.ts",
    "src/database/standalone-migration.spec.ts",
    "package.json",
    "package-lock.json",
    ".github/workflows/ci.yml"
  ],
  "tests": [
    "test/scripts/sdd-traceability.test.cjs",
    "src/application/integrations/integration-processor.service.spec.ts",
    "src/infrastructure/guards/integration-hmac.guard.spec.ts",
    "src/database/standalone-migration.spec.ts"
  ],
  "removed": []
}
```

## Riesgos y responsables

Backend mantiene recuperación, migraciones y HMAC. El mantenedor confirma los archivos y configura protección de main. Validar PostgreSQL 16 y Docker en CI; los mocks no certifican SII. La base compartida requiere respaldo y plan de cambios propio: el rollback automático de la base se rechaza deliberadamente.
