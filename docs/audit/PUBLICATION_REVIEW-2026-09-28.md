# Auditoría previa a publicación — 2026-09-28

## Alcance

Revisión del diff respecto de b44eb41 y del inventario de archivos nuevos; foco en SDD/CI, contratos HTTP, migraciones, recuperación RCOF, HMAC, dependencias y material privado. Incluye trabajo previo del motor/XML/PDF/branding. No certifica SII ni audita el despliegue Render actual.

## Hallazgos corregidos

| Hallazgo                                                                          | Corrección                                                                        | Evidencia                                                   |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| TypeORM rechaza una migración cuyo timestamp es cero.                             | Base renombrada a 1804900000000, anterior al esquema B2B.                         | standalone-migration.spec.ts usa el MigrationExecutor real. |
| El rollback base podía eliminar tablas reutilizadas del ERP.                      | Se rechaza sin ejecutar DROP; exige un plan revisado por instalación.             | Prueba de rechazo y de ausencia de SQL destructivo.         |
| Una caída tras guardar el RCOF final dejaba la request submitted sin reconciliar. | Se consolida accepted/rejected persistido sin retransmitir ni consultar de nuevo. | Dos regresiones en integration-processor.service.spec.ts.   |
| Una credencial v2 sin secreto cifrado podía caer al hash legado.                  | Se rechaza con 401/INVALID_SIGNATURE.                                             | integration-hmac.guard.spec.ts.                             |
| Avisos de dependencias Undici y js-yaml.                                          | Parche compatible y lockfile actualizado, sin audit fix --force.                  | npm audit informa cero avisos tras la actualización.        |

## Comprobaciones locales

- Build aprobado; 29 suites/140 tests unitarios aprobados.
- Controles SDD: 18 tests; 10 features, 17 filas y tres fichas válidas, diff completo declarado. Se comprueba ownership en todas las tablas de deuda técnica.
- repo:check aprobado: sin nombres de archivos privados versionados y con exclusiones Git/Docker.
- Gitleaks 8.30.1, descarga con checksum verificado, historial completo de 13 commits sin detecciones. El diff detectó una clave sintética de idempotencia en un test; se anotó sólo esa línea como valor público de fixture. La repetición sobre el conjunto preparado para commit pasó sin detecciones.
- Node local 24.19.0; PostgreSQL 16, Node 22 y Docker deben comprobarse con CI remoto.

## Límites y seguimiento

Las decisiones de retenciones T46, aprobación de XML/firma en SII, provisioning y validación de operación desplegada conservan sus responsables en DECISIONS/TECHNICAL_DEBT. La reserva de folio y el vínculo request/DTE no constituyen una transacción única; outbox webhook también sigue pendiente. Las escrituras administrativas completas de tenant_configs deben revisarse frente a reservas de folio de otro proceso: el lock por sí solo no vuelve fresca una copia leída antes.

El repositorio remoto ya es público. Se mantiene la licencia pendiente por indicación del autor. Sólo hay un mantenedor; la protección de main exigirá PR y CI, sin requerir una revisión imposible del propio autor. Se exigirá revisión de otro mantenedor cuando haya uno disponible.

El escáner busca patrones conocidos y no garantiza ausencia de todos los secretos.

## Resultado remoto y configuración aplicada

[PR #1](https://github.com/angelo121514/cmorflow-tax-api/pull/1) contiene el conjunto revisado. [CI 36509848966](https://github.com/angelo121514/cmorflow-tax-api/actions/runs/36509848966) aprobó ee92bf6: 140 tests unitarios, 10 e2e sin omisiones con PostgreSQL 16, 18 del checker, contrato y build Docker. La ejecución usa Node 22; el Dockerfile usa 22.12.0.

GitHub confirmó reportes privados de vulnerabilidades habilitados y main protegido: PR obligatorio, backend de GitHub Actions aprobado sobre base actualizada, admins sujetos a las reglas, historial lineal, conversaciones resueltas, sin force push ni eliminación. El mínimo de aprobaciones es cero porque sólo existe el mantenedor propietario.

Se actualizan checkout/setup-node a releases oficiales v7 fijadas por SHA para retirar el aviso de runtime obsoleto detectado en esa ejecución. Las validaciones de los commits posteriores se consultan en los checks del PR; main exige que estén aprobadas para integrar.
