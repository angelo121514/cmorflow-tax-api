# Validación MIT y SDD — 2026-10-13

Los resultados de esta entrega se registran aquí tras ejecutar las comprobaciones. Baseline runtime a2aef05; Node local 24.19.0, CI exige Node 22 y PostgreSQL 16. No se prueba SII real ni configuración Render.

## Resultados

| Comprobación                              | Resultado local                                                                           |
| ----------------------------------------- | ----------------------------------------------------------------------------------------- |
| repo:check                                | Aprobado; sólo nombres y exclusiones, no escaneo de contenido                             |
| sdd:test                                  | 32 tests aprobados, sin omisiones                                                         |
| sdd:check contra origin/main con worktree | Aprobado: 10 features, 17 filas y 4 fichas; diff completo declarado                       |
| build                                     | Aprobado                                                                                  |
| MIT                                       | LICENSE, atribución, manifiestos y private: true coherentes; imagen incluye avisos        |
| OpenAPI, unitarios y e2e                  | En ejecución; se actualizará con resultado final                                          |
| npm audit --omit=dev --audit-level=high   | Falla: 6 avisos (2 moderate, 3 high, 1 critical); node-forge sin fix disponible. TASK-007 |
| PostgreSQL 16 y Docker                    | Pendientes de ejecución CI sobre el PR                                                    |

Avisos detectados en dependencias preexistentes: brace-expansion, js-yaml/@nestjs/swagger, node-forge, proxy-addr y sharp. No se cambian versiones ni se desactiva el gate en esta entrega de licencia/SDD. Audit se ejecuta al final del job para obtener evidencia funcional y Docker incluso cuando ese gate falla. Main exige backend aprobado; no integrar mientras falle.

Los resultados históricos están en [TESTING](TESTING.md).

## Alcance

El checker valida presencia, enlaces locales y estructura de tareas, no semántica de cobertura ni eficacia en producción. MIT coherente en manifiestos no determina licencias de recursos externos: [avisos](../../THIRD_PARTY_NOTICES.md), TASK-006. La comparación no ejecuta suites de los repositorios de referencia.

## Evidencia remota

[PR #2](https://github.com/angelo121514/cmorflow-tax-api/pull/2), [CI 38484270148](https://github.com/angelo121514/cmorflow-tax-api/actions/runs/38484270148) sobre 9c325fc: Node 22, checker, trazabilidad, 140 unitarios, 10 e2e PostgreSQL 16, OpenAPI y Docker aprobados. El job termina failure exclusivamente en Dependency security gate por los seis avisos registrados. No se integra ni despliega; se conserva la protección backend obligatoria. El commit posterior sólo actualiza esta evidencia y los criterios documentales; sus checks siguen siendo obligatorios antes de integrar.
