# MIT y gobierno SDD

## Problema y resultado esperado

El repositorio público carecía de licencia y el SDD no explicitaba constitución, amenazas ni tareas comparables a las referencias del autor. Esta entrega declara MIT para código original y completa gobierno con controles estructurales.

## Especificación y decisiones

Se conservan F-xx, BR-xx y D-xxx. Constitución, modelo de amenazas, plan y tareas enlazan implementación y riesgos existentes; las condiciones de recursos externos no se asumen MIT. No cambia runtime ni los bloqueos D-006/D-007.

## Criterios de aceptación

- [x] LICENSE y manifiestos declaran MIT con atribución; private permanece true.
- [x] SDD documenta comparación, amenazas y tareas con responsable y evidencia.
- [x] Checker rechaza documentos ausentes, enlaces rotos y tareas incompletas.
- [x] Validaciones locales y CI quedan registradas con omisiones explícitas.

## Pruebas y trazabilidad

Las regresiones focales del checker prueban ausencia documental, enlaces y campos de tareas. VALIDATION_REPORT registra resultados reales antes de integrar.

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
    "docs/spec/CONSTITUTION.md",
    "docs/spec/THREAT_MODEL.md",
    "docs/spec/PLAN.md",
    "docs/spec/TASKS.md",
    "docs/spec/IMPLEMENTATION_STATUS.md",
    "docs/spec/VALIDATION_REPORT.md",
    "docs/spec/COMPARISON_REPORT.md"
  ],
  "code": [
    "scripts/check-sdd-traceability.cjs",
    "test/scripts/sdd-traceability.test.cjs",
    "Dockerfile",
    "package.json",
    "package-lock.json",
    ".github/workflows/ci.yml",
    "LICENSE",
    "THIRD_PARTY_NOTICES.md"
  ],
  "tests": [
    "test/scripts/sdd-traceability.test.cjs"
  ],
  "removed": []
}
```

## Riesgos y responsables

Mantenedor conserva avisos, valida condiciones externas y revisa PR/CI. Backend mantiene controles y tareas de concurrencia y entrega; Tributario/Operaciones resuelven bloqueos externos. Esta documentación no certifica SII ni corrige las tareas de runtime pendientes.
