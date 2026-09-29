# Informe de auditoría de especificación e implementación SDD

## Resumen ejecutivo

CmorFlow Tax API es una API B2B NestJS para emisión asíncrona de documentos tributarios chilenos y RCOF. Usa HMAC por credencial/tenant, PostgreSQL como persistencia y cola durable, un worker separado, cliente SII SOAP/multipart, y webhooks salientes firmados. También ofrece credenciales, configuración CAF/certificado y marca de PDF.

Esta reconstrucción cubre módulos, 32 rutas observadas en código (31 operaciones del baseline Swagger más /metrics), tablas, flujos, tests existentes e infraestructura declarada. No es certificación SII ni revisión de producción.

## Alcance y método de la auditoría inicial

La auditoría inicial examinó estructura del repositorio; package/configuración; README y guías existentes; DTOs/controladores; módulos/casos de uso; entidades y migraciones; guardas, criptografía, motor SII; tests; CI, Docker, Render y monitoreo. Sus observaciones de código describen esa revisión inicial y no necesariamente el checkout actualizado. La sección de seguimiento registra los cambios y comprobaciones de esta implementación.

La comprobación npm run openapi:check sí se ejecutó: **sin drift, 27 paths del baseline**. Esta comprobación compara documento generado con archivo baseline, no completitud o exactitud semántica. El entorno local es Node 24.19.0, fuera del rango declarado Node 22.12–22.x.

## Nivel de confianza de la auditoría inicial

| Área                                | Confianza                                                            | Razón                                                                                               |
| ----------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Módulos y arquitectura en código    | Alta                                                                 | AppModule, módulos Nest, puntos de entrada y dependencias inspeccionados.                           |
| API y validación                    | Alta en método/ruta/guards/DTO; media en códigos y cuerpos completos | Controladores leídos; documentación de respuestas es irregular.                                     |
| Modelo PostgreSQL definido por repo | Alta                                                                 | Entidades y todas las migraciones inspeccionadas.                                                   |
| Dominio y reglas en código          | Media-alta                                                           | Reglas se encuentran en validadores/motores y están contrastadas; legalidad vigente no certificada. |
| Tests disponibles                   | Alta en inventario; baja en cobertura efectiva de esta revisión      | Archivos/CI revisados; no se ejecutó Jest ni coverage.                                              |
| Operación desplegada                | Baja/desconocida                                                     | Render, SII real, DB, secretos y roles remotos no inspeccionados.                                   |

## Arquitectura, módulos y dominio

- **Arquitectura:** NestJS API, Postgres/RLS, cola en DB, worker periódico, motor tributario XMLDSig/PDF, SII externo, webhooks HTTPS y Prometheus.
- **Módulos principales:** controllers, application/dte, application/integrations, infrastructure/framework/sii, infrastructure/framework/postgres y security/config.
- **Dominio principal:** tenant/contribuyente, solicitud de integración, DTE/folio, RCOF, credencial y entrega webhook.
- **Funciones principales:** emitir/consultar DTE y notas; solicitar RCOF; bajar XML/PDF; administrar credenciales y webhooks; configurar CAF/PFX y marca; salud, cron y métricas.
- **Integraciones:** PostgreSQL/Supabase, SII, endpoints webhook, Render, GitHub Actions y Prometheus. No se encontraron clientes pagos, correo, Shopify o WooCommerce.

## Hallazgos de la auditoría inicial

Los siguientes puntos son el registro histórico que motivó el plan. Su estado actual está en [TECHNICAL_DEBT.md](TECHNICAL_DEBT.md); no deben interpretarse como defectos todavía abiertos sin revisar esa matriz.

1. Polling lee solicitudes submitted; la transición observed existe pero no se ve poller de observed, por lo que reparos pueden no llegar a estado final.
2. RCOF diario crea submission sin integration_request; poller actual descubre RCOF desde requests con rcofId. Estado de RCOF diario requiere validación.
3. Contrato API/Swagger no declara seguridad por operación ni todas las respuestas; script solo detecta diferencias vs baseline.
4. Credenciales API pueden recibir webhooks:read según validación de tipo, aunque documentación presenta permisos administrativos separados.
5. Permiso dte:cancel y estado cancelled existen sin ruta de cancelación.
6. Enlace self para estado construido por servicio compartido usa /dtes incluso en respuesta RCOF.
7. Comprobación de total XML no considera resta de retenciones, mientras motor sí; revisar T46/retenciones.
8. Manejo de respuesta de webhook lee body entero luego de limpiar abort timer.
9. Alta de tenant/perfil tributario no es visible por HTTP; se desconoce operación previa requerida.
10. Historial de deliveries no especifica orden antes de tomar últimas 50; rate limit de credencial vive en memoria.
11. Creación concurrente de solicitudes con la misma clave puede competir entre find e insert; la ruta de conflicto no captura explícitamente la constraint unique.

No se registran como defectos actuales hallazgos de AUDITORIA-2026-09-19 que no coinciden con el working tree local. Este árbol contiene cambios no confirmados en 76 entradas; ejemplos de evolución observada incluyen firma con xml-crypto, signing v2, folio con contexto RLS y gestión branding. No se verificaron todas esas correcciones con tests.

## Inconsistencias documentales observadas inicialmente

- GUIDE.md dice que registrar webhook usa JWT interno; los controllers actuales aplican HMAC.
- GUIDE.md pide Idempotency-Key UUID; el código solo exige header presente.
- GUIDE.md afirma que URL de RCOF GET/estado está ligado a /rcof; buildStatus comparte link self a /dtes.
- OpenAPI baseline existe y checker pasa, pero ninguna operación declara security ni completa respuestas; es un contrato incompleto, no prueba de auth.
- Algunas variables de endpoint/timeouts SII leídas por código no están en .env.example.

## Cobertura de pruebas observada inicialmente

Hay unit tests de HMAC/credenciales, idempotencia/estados/cola/processor, RCOF/webhooks/artefactos, CAF/descuentos/XML/firma/PDF/branding/timezone/SOAP y config. E2E cubre app boot, runtime config, HMAC y PostgreSQL real (RLS/concurrencia). CI configura Node 22 y Postgres 16.

La auditoría inicial no ejecutó las suites ni consultó cobertura, por lo que no afirmó un porcentaje. El resultado de las pruebas de esta implementación aparece en `docs/spec/TESTING.md`. La cobertura por archivo no prueba cada controller, SII real ni certificación tributaria.

## Validaciones externas que siguen pendientes

- Proceso de provisioning tenant/perfil tributario y política de admin/API.
- Certificación del XML y firma con esquema vigente y ambiente SII correspondiente.
- Retenciones T46, reparos, notas y cancelación/rectificación como flujos tributarios.
- Recuperación de RCOF diario en PostgreSQL 16 CI y smoke de varios tenants en un ambiente SII real.
- RLS con el rol de aplicación real, separación de tenant/worker y migraciones contra base compartida.
- Despliegue Render real, worker activo, schedule externo, secretos y certificados.
- Orden de eventos/reintentos y límites de webhook con consumidor real.

## Criterios que guiaron la implementación SDD

1. Mantener `SPEC_INDEX.md` y `TRACEABILITY.md` como mapas de cada cambio.
2. Declarar seguridad, requests, responses y errores en OpenAPI y revisar drift en CI.
3. Fijar criterios observables por feature para estados, idempotencia, tenant boundary, errores y recuperación.
4. Cubrir brechas funcionales con pruebas focales y mantener ejecución Postgres en CI.
5. Registrar decisiones y bloqueos externos para provisioning y validación tributaria.
6. Validar XML/firma contra SII vigente con evidencia fechada antes de afirmar certificación.

## Implementación posterior del plan SDD (2026-09-27)

Se implementaron correcciones para polling DTE/RCOF en estado observed, encolado durable del RCOF diario con replay estable, request interna sin credencial API, resolución de violaciones únicas de idempotencia, permisos administrativos de webhooks, enlace self RCOF, límite/timeout de respuesta webhook, y orden del historial. El contrato OpenAPI se completa para las 31 operaciones y el flujo SDD añade plantilla, decisiones registradas y `sdd:check` en CI.

El cálculo/preflight tributario T46 **no se modificó**: está bloqueado a evidencia y aprobación del responsable tributario/SII. El runbook de provisioning de tenants también está bloqueado; el repositorio no contiene el proceso operativo autorizado.

Los resultados del build, pruebas unitarias/e2e, OpenAPI drift/completitud y trazabilidad están registrados en `docs/spec/TESTING.md` tras su ejecución. El build de imagen y la verificación PostgreSQL local dependen de Docker, cuyo daemon no estaba disponible en el entorno de esta implementación. Node local fue 24.19.0, fuera del rango 22 declarado por CI. La certificación contra SII y la revisión del despliegue remoto no se pueden inferir de estas pruebas locales.

## Archivos generados y actualizados

La implementación posterior modificó código de aplicación, configuración, migración, pruebas y documentación; el árbol de trabajo también contenía cambios previos de auditoría y producto. Los archivos bajo `docs/spec/` describen el alcance SDD y el estado de sus bloqueos.

## Organización posterior para colaboradores (2026-09-28)

Se añadieron guías de contribución, reporte privado de vulnerabilidades, código de conducta, changelog, navegación documental y templates de PR/issues. CI verifica referencias SDD reales y cobertura de los archivos relevantes del diff, con fichas en `docs/spec/changes/`. La matriz distingue pruebas relacionadas de brechas conocidas; el contrato de configuración CAF/firma/folios ahora declara las respuestas concretas.

La comprobación local aprobó build, 28 suites/135 tests unitarios, 17 tests de los controles SDD, contrato sin drift y trazabilidad del árbol local. [TESTING.md](TESTING.md) registra el entorno y los límites. La primera ejecución remota de CI, configuración de protección de main y revisión de contenido/historial antes de publicar siguen pendientes. La licencia se aplaza por indicación del autor.
