# Estado de implementación

Revisión 2026-10-13. Baseline de runtime a2aef05; esta entrega sólo cambia licencia, documentación y checker.

| Capacidad                               | Estado                                                             | Evidencia / límite                                                               |
| --------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| F-01–F-10                               | Implementadas con pruebas existentes; no equivalen a certificación | [Matriz](TRACEABILITY.md), [testing histórico](TESTING.md)                       |
| SDD por cambio                          | Implementado y exigido en CI                                       | Fichas y checker; evaluación semántica sigue siendo humana                       |
| Constitución, amenazas y seguimiento    | Incorporados en esta entrega                                       | [Constitución](CONSTITUTION.md), [amenazas](THREAT_MODEL.md), [tareas](TASKS.md) |
| MIT                                     | Declarada para código original                                     | [Licencia](../../LICENSE); terceros conservan condiciones propias                |
| Permisos de todos los recursos externos | No determinados completamente                                      | TASK-006, [avisos](../../THIRD_PARTY_NOTICES.md)                                 |
| Concurrencia CAF, recuperación y outbox | Pendientes; no corregidos por documentación                        | TASK-001/002/003                                                                 |
| Provisioning y certificación SII/T46    | Bloqueados externamente                                            | TASK-004/005, D-006/D-007                                                        |
| Despliegue actual                       | No inspeccionado en esta entrega                                   | CI no prueba configuración remota                                                |

[Informe de validación](VALIDATION_REPORT.md) registra únicamente resultados ejecutados. Los checkboxes históricos de 0001 conservan su estado original; no se marcan como cumplidos sin revisión semántica específica.

El gate de dependencias actual detecta avisos high/critical en paquetes existentes: TASK-007. La entrega no está habilitada para integrar hasta obtener backend aprobado.

CI 38484270148 aprobó 140 unitarios, 10 e2e PostgreSQL 16, checker, OpenAPI y Docker; el job falla sólo por el gate de dependencias. Ver [evidencia](VALIDATION_REPORT.md).

## Corrección 2026-10-14

Se implementan mutaciones frescas de CAF/config, preparación atómica y outbox sobre tablas existentes. El marcador de transmisión bloquea reenvíos ambiguos. Se elimina node-forge, actualizan dependencias y se configura obtención externa de recursos sin licencia documentada. Provisioning CLI está disponible sólo para base independiente. TASK-005 y la validación operativa staging siguen externas. El estado histórico anterior se conserva; resultados vigentes en [VALIDATION_REPORT](VALIDATION_REPORT.md).

## Estado vigente tras CI 38598285603

Correcciones de TASK-001/002/003/006/007 aprobadas: 141 unitarios, 18 e2e, Docker, SDD/OpenAPI y cero vulnerabilidades de producción. El bloqueo de dependencias de la entrega anterior está resuelto; persisten 20 moderate sólo en tooling de desarrollo. TASK-004 mantiene aprobación/ejecución staging y fuente ERP pendientes; TASK-005 continúa externa. Para actualizar un entorno real aplicar migración y proveer XSD/CA externos antes del worker. No se ha desplegado ni integrado el PR.
