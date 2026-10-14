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

## Corrección 2026-10-14 — validada en CI

- npm audit --omit=dev --audit-level=moderate: cero vulnerabilidades de producción después de retirar node-forge y actualizar parches/override compatible js-yaml 5.4.3.
- Audit completo: cero high/critical; persisten 20 avisos moderate en herramientas Jest/ts-jest de desarrollo. No se aplican downgrades incompatibles sugeridos automáticamente. Jest 30 y ts-jest 29.4.14 conservan compatibilidad documentada por sus peers.
- Build y tests de firma nativa, transacciones y e2e aprobados en CI. Docker local no disponible en esta sesión; el build remoto aprobó.
- Se retiran ocho XSD SII y CA Supabase de distribución actual, sin reescribir historial. Su instalación externa es requisito de actualización para entornos reales.
- provisioning independiente implementado; no equivale a aprobación staging ni a certificación SII.

### Resultado remoto de la corrección

[CI 38598285603](https://github.com/angelo121514/cmorflow-tax-api/actions/runs/38598285603) aprobó **6b6002f**, Node 22 y PostgreSQL 16:

| Comprobación                       | Resultado                                                 |
| ---------------------------------- | --------------------------------------------------------- |
| Build                              | Aprobado                                                  |
| Unitarios                          | 30 suites, 141 tests aprobados                            |
| E2e                                | 5 suites, 18 tests aprobados, sin omisiones               |
| SDD                                | 32 tests, 10 features, 17 filas y 5 fichas; diff aprobado |
| OpenAPI                            | 27 paths sin drift                                        |
| Docker                             | Build aprobado; incluye OpenSSL, licencia y avisos        |
| Audit producción (umbral moderate) | Cero vulnerabilidades; gate aprobado                      |

Pruebas nuevas usan repositorios/servicios y DB reales con caídas inyectadas como errores; no simulan SIGKILL de un proceso ni certifican el transporte SII. Se controlan preparación y transporte externos para aislar las garantías de persistencia. Hay evidencia de rollback, concurrencia de conexiones y recuperación de leases. El receptor webhook aún debe deduplicar entregas; no se promete exactly-once remoto.

El commit siguiente sólo registra evidencia documental. CI sigue siendo obligatorio sobre la cabecera del PR antes de integrar. No se despliega ni se fusiona esta tarea. TASK-004 (staging/ERP) y TASK-005 (SII/T46) conservan responsables externos. El informe anterior de dependencia bloqueada queda como historia, superado por esta corrección.

## Publicación GitHub 1.0.0-oss.1 — 2026-10-14

Render confirmó autoDeploy=no / autoDeployTrigger=off antes de fusionar. Se conserva el despliegue dep-dacabn15efls73dmbdfg, commit 49bb9d80c1e4e7826dc4087a9e633886528b4673. Gitleaks 8.30.1 revisó el snapshot de publicación y los 21 commits disponibles antes del commit de publicación, sin detecciones y con reportes redactados. Sólo .env.example está versionado entre archivos de entorno; no hay PFX/P12/KEY/respaldos ni carpeta .git en el árbol. La versión pública y README se preparan en PR #2; CI final y SHA squash se registrarán en las notas de release verificadas. No se modifican otros servicios ni se solicita despliegue.
