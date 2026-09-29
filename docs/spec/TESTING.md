# Estrategia y cobertura de pruebas

## Inventario

La configuración Jest de package.json descubre *.spec.ts bajo src; test/jest-e2e.json descubre pruebas e2e. `sdd:test` usa el runner nativo de Node para probar los controles del repositorio. CI en .github/workflows/ci.yml usa Node 22 y Postgres 16, comprueba protección de archivos privados, controles SDD y trazabilidad del diff; después corre build, suites unitarias, e2e, verificación OpenAPI, Prettier para render.yaml y docker build.

Se encontraron tests unitarios/de servicio para:

- HMAC, firma canónica, credenciales, permisos, nonces y guards de cron.
- Idempotencia, validación de DTE, state machine, processor, queue claimer, RCOF, webhook, artefactos.
- CAF, descuentos, reglas XML, firma, PDF, marca, zona horaria, cliente SOAP, runtime config y métricas.
- Límites DTO de porcentaje y esquema DTE.

Pruebas e2e: app boot, autenticación HMAC, validación de runtime config y PostgreSQL. PostgreSQL e2e crea/ejecuta migraciones y prueba RLS multi-tenant, idempotencia y reclamos concurrentes. Helpers de memoria reemplazan persistencia para pruebas rápidas.

## Qué demuestra la suite en fuente

Los tests describen expectativas importantes: nonce replay es bloqueado; tenant deriva de credencial; solicitud repetida y cuerpo igual devuelve replay; distintos cuerpos generan conflicto; folio no se prepara dos veces cuando dteId ya existe; firma webhook verificable; RLS aísla tenants con DB real. Mocks y fixtures se concentran en servicios y casos de uso.

La mera presencia de tests no demuestra que pasen en el checkout analizado. La auditoría inicial no ejecutó suites ni build; este cambio agrega pruebas para observed, RCOF diario durable, carreras de idempotencia, scopes admin-only, links RCOF y respuesta webhook acotada y lenta.

## Ejecución local de esta implementación (2026-09-27)

| Comando                                    | Resultado                                                                                                                      |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `npm run build`                            | OK. TypeScript compiló.                                                                                                        |
| `npm test -- --runInBand`                  | OK: 27 suites y 132 tests aprobados.                                                                                           |
| `npm run test:e2e -- --runInBand`          | 2 suites aprobadas; 2 suites de PostgreSQL omitidas; 3 tests aprobados y 7 omitidos. `POSTGRES_E2E_URL` no estaba configurada. |
| `npm run openapi:check`                    | OK: 27 paths, sin drift; verificador también comprueba seguridad, permisos, errores y schemas por operación.                   |
| `npm run sdd:check`                        | OK: 10 features, 17 filas de trazabilidad y seguridad por operación.                                                           |
| `npx prettier --check render.yaml`         | OK.                                                                                                                            |
| `docker build --tag cmorflow-tax-api:ci .` | No ejecutable en este equipo: el daemon Docker Desktop no estaba disponible.                                                   |

El checkout se ejecutó con Node `v24.19.0`; CI declara Node 22. Por eso los resultados locales no sustituyen la corrida CI con Node 22 y PostgreSQL 16. Las pruebas de PostgreSQL —incluyendo migración de solicitudes RCOF internas, RLS e idempotencia bajo carreras— quedan pendientes de esa corrida. No se generó reporte de coverage ni se probó con el SII real.

## Organización y contratos: comprobación local (2026-09-28)

| Comando                                            | Resultado                                                                                                                                                       |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run build`                                    | OK: TypeScript compiló.                                                                                                                                         |
| `npm test -- --runInBand --silent`                 | OK: 28 suites y 135 tests aprobados, incluidos los tres casos nuevos del contrato Swagger.                                                                      |
| `npm run sdd:test`                                 | OK: 17 tests. Comprueba referencias rotas, diff sin ficha, archivos sin declarar, feature desconocida, eliminaciones, exclusiones privadas y metadata inválida. |
| `npm run test:e2e -- --runInBand`                  | 2 suites/3 tests aprobados; 2 suites/7 tests de PostgreSQL omitidos porque falta POSTGRES_E2E_URL.                                                              |
| `npm run sdd:check -- --base-ref HEAD --worktree`  | OK: 10 features, 17 filas y 2 fichas; incluye cambios locales y archivos nuevos en la comprobación del diff.                                                    |
| `npm run repo:check`                               | OK: no hay nombres de archivos privados versionados y las exclusiones requeridas están declaradas para Git/Docker, incluidas subcarpetas de Docker.             |
| `npm run openapi:update` y `npm run openapi:check` | OK: baseline generado y revisado; 27 paths sin drift. CAF/firma declaran campos y folios devuelve un array tipado.                                              |
| `npx prettier --check ...`                         | OK: scripts, pruebas nuevas, guías, templates, matrices, contrato, workflow y render.yaml.                                                                      |
| Parseo YAML con `js-yaml`                          | OK: workflow CI y las tres configuraciones de issues. No ejecuta GitHub Actions.                                                                                |
| `git diff --check`                                 | OK: sin errores de whitespace.                                                                                                                                  |

Esta ejecución usó Node `v24.19.0`. La ejecución remota de CI en Node 22/PostgreSQL 16 y el build Docker siguen pendientes. `repo:check` controla nombres y exclusiones; no inspecciona secretos dentro del contenido o del historial. Las guías se revisaron contra la configuración del repositorio; no se reprodujo una instalación completa en una máquina nueva.

## Auditoría previa a subir cambios (2026-09-28)

Después de corregir recuperación RCOF, fallo cerrado HMAC v2 y la migración base, `npm run build` y la suite completa pasan: 29 suites/140 tests. `sdd:test` aprueba 18 casos, incluida la validación de todas las tablas de deuda; el diff respecto a origin/main está declarado en tres fichas. `openapi:check` confirma 27 paths sin drift. Tras actualizar Undici y js-yaml con cambios compatibles, `npm audit` y `npm audit --omit=dev` informan cero vulnerabilidades conocidas al momento de esta revisión.

El escaneo Gitleaks del historial revisó 13 commits sin detecciones. El escaneo del diff encontró sólo la clave sintética de idempotencia de un test; la anotación está limitada a esa línea. El informe [PUBLICATION_REVIEW-2026-09-28.md](../audit/PUBLICATION_REVIEW-2026-09-28.md) describe alcance y seguimiento remoto.

## Primera ejecución remota completa (2026-09-28 en Chile)

[CI 36509848966](https://github.com/angelo121514/cmorflow-tax-api/actions/runs/36509848966) aprobó el commit `ee92bf6`: Node 22, PostgreSQL 16, 29 suites/140 tests unitarios, 4 suites/10 tests e2e **sin omisiones**, 18 tests del checker, trazabilidad, contrato y build Docker con Node 22.12.0. Esto confirma las pruebas de PostgreSQL incluidas en el repo; no valida todos los escenarios de caída ni SII real.

El aviso de runtime obsoleto de checkout/setup-node motivó actualizarlas a sus releases oficiales v7 y fijarlas por SHA. CI comprueba estos ajustes en cada commit del PR antes de integrar.

## Brechas funcionales que siguen pendientes

- No hay suite que pruebe cada ruta HTTP con guards/DTOs/códigos/contratos; los e2e visibles cubren auth, boot y runtime más DB.
- No hay prueba con conexión/certificado de SII real; SOAP normalmente se prueba con mock/Fetch simulado.
- No se encuentra prueba de recuperación de worker tras caída entre reserva de folio, persistencia DTE, vínculo a request y transmisión.
- RCOF diario se valida por unidad y migración/Postgres; falta un smoke de ambiente SII real para varios tenants.
- Los escenarios de carrera multi-worker y RLS dependen de POSTGRES_E2E_URL y del servicio Postgres del CI; no se ejecutaron aquí.
- No se encontró cobertura de ramas/porcentaje de líneas actual. coverage/ ya existe en el workspace, pero no fue generada ni atribuida a esta revisión.
- `openapi:check` valida completitud, permisos, seguridad y schemas además de drift; `sdd:check` valida referencias existentes, plantilla, ownership de deuda y archivos relevantes del diff cuando se indica una base. Ninguno demuestra automáticamente la cobertura semántica de cada criterio.
- La respuesta HTTP de stock de folios ahora tiene contrato explícito, pero falta una prueba focal del cálculo y de esa ruta con sus guards; la matriz registra esta brecha.

## Fixtures, mocks y dependencias de pruebas

FreshMemoryModule/FreshMemoryDataService implementa persistencia simulada; unit tests inyectan dobles de repositorio, SII y fetch. El mock SII produce TrackID/status deterministas. Postgres e2e requiere variable POSTGRES_E2E_URL. CI provisiona Postgres 16 y Node 22.

## Lectura recomendada de resultados

Separar unit mocks, e2e con Postgres y validación SII real. Aprobación del mock no certifica XML contra SII, funcionamiento de credenciales productivas ni alcance RLS del rol remoto.
