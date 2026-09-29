# Organización profesional y colaboración

## Problema y resultado esperado

El SDD tenía documentos y checks básicos, pero admitía referencias inexistentes y cambios sin ficha. Los colaboradores necesitan una vía de instalación, contribución y revisión clara, y contratos concretos para configuración.

## Especificación y decisiones

El flujo por PR exige referencias existentes y cobertura de los archivos relevantes del diff. Las pruebas pueden omitirse sólo con motivo concreto. Las decisiones tributarias conservan sus bloqueos; la elección de licencia se aplaza por indicación del autor. Los contratos CAF/firma/folios se alinean con las respuestas actuales sin cambiar ejecución de negocio.

## Criterios de aceptación

- [x] El checker integrado en CI rechaza referencias inexistentes, una feature desconocida y cambios de código sin ficha actualizada, comprobado con fixtures locales.
- [x] El diff local declara todos los archivos relevantes en fichas SDD; CI exige la misma regla sobre la base del PR.
- [x] CAF y firma declaran sus campos y folios se documenta como una lista de stock.
- [x] README y guías documentan instalación en modo mock y procedimiento de contribución.
- [x] Las reglas de Git/Docker excluyen entornos privados y llaves; el control detecta un .env.local forzado a Git y patrones privados ausentes.

## Pruebas y trazabilidad

sdd:test aprueba 17 casos de rechazo/aceptación con repositorios temporales y datos sintéticos. api-contract.spec.ts aprueba tres casos de respuestas genéricas, referencias ausentes y arrays tipados. Build, OpenAPI, repo:check, comprobación SDD del árbol local y 28 suites/135 tests unitarios pasan. TESTING.md registra resultados, Node local 24 y validación remota pendiente.

```sdd
{
  "features": [
    "F-06",
    "F-10"
  ],
  "specs": [
    "docs/spec/API_SPEC.md",
    "docs/spec/TRACEABILITY.md",
    "docs/spec/SPEC_INDEX.md",
    "docs/spec/TESTING.md"
  ],
  "code": [
    "scripts/check-sdd-traceability.cjs",
    "scripts/check-repository.cjs",
    "scripts/check-openapi-drift.ts",
    "src/infrastructure/swagger/api-contract.ts",
    "src/infrastructure/swagger/api-contract.spec.ts",
    "test/scripts/sdd-traceability.test.cjs",
    "package.json",
    ".github/workflows/ci.yml",
    ".gitignore",
    ".dockerignore",
    "README.md",
    "CONTRIBUTING.md",
    "SECURITY.md",
    "CODE_OF_CONDUCT.md",
    "CHANGELOG.md",
    "docs/README.md",
    "docs/maintainers/RELEASING.md",
    "docs/spec/CHANGE_TEMPLATE.md",
    "docs/spec/SPEC_INDEX.md",
    "docs/spec/TRACEABILITY.md",
    ".github/PULL_REQUEST_TEMPLATE.md",
    ".github/ISSUE_TEMPLATE/bug_report.yml",
    ".github/ISSUE_TEMPLATE/feature_request.yml",
    ".github/ISSUE_TEMPLATE/config.yml",
    ".nvmrc",
    "ohbs-openapi.json"
  ],
  "tests": [
    "test/scripts/sdd-traceability.test.cjs",
    "src/infrastructure/swagger/api-contract.spec.ts"
  ],
  "removed": []
}
```

## Riesgos y responsables

Backend mantiene el checker y el contrato. El mantenedor del repositorio configura protección de main, reportes privados y revisión de historial antes de publicar. Los checks verifican referencias y estructura; la calidad semántica y aprobación tributaria siguen dependiendo de revisión humana. No hay commit/push ni modificación de visibilidad en esta tarea.
