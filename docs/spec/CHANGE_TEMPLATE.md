# Propuesta SDD: <título>

Copiar a docs/spec/changes/NNNN-descripcion.md. Sustituir ejemplos y marcadores con referencias reales desde la raíz del repositorio. No usar globs ni rutas absolutas.

## Problema y resultado esperado

Describe el problema, usuarios/tenants afectados y resultado verificable.

## Alcance

- Incluye:
- Compatibilidad y límites:
- Feature IDs afectados (F-xx):

## Especificación y decisiones

Indica las specs afectadas, reglas, decisiones aprobadas y responsables. Explica los supuestos y bloqueos externos.

## Contratos e impacto

Describe rutas, scopes, DTOs, respuestas, errores, persistencia, migración, despliegue y rollback afectados.

## Criterios de aceptación

- [ ] El resultado exitoso tiene un comportamiento observable.
- [ ] Los errores, permisos y límites entre tenants están definidos.
- [ ] Idempotencia, reintentos y recuperación quedan documentados si aplican.

## Pruebas y trazabilidad

Enumera los escenarios y resultados reales. El bloque siguiente se verifica en CI: code y tests deben cubrir los archivos relevantes del diff. removed se usa para eliminaciones. Si no hacen falta pruebas, deja tests vacío y añade testExemption con la razón concreta.

```sdd
{
  "features": [
    "F-01"
  ],
  "specs": [
    "docs/spec/FEATURES.md",
    "docs/spec/API_SPEC.md"
  ],
  "code": [
    "src/controllers/dtes.controller.ts"
  ],
  "tests": [
    "src/application/integrations/integration-request.service.spec.ts"
  ],
  "removed": []
}
```

## Riesgos y responsables

Documenta riesgos/deuda residual, responsable, motivo, recuperación y aprobaciones externas. Actualiza TECHNICAL_DEBT.md si el riesgo permanece.
