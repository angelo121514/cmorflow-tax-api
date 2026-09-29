# Auditoría CmorFlow Tax API — 19 de septiembre de 2026

**Dictamen: NO está lista para clientes ni se puede afirmar que la emisión real funcione correctamente.** Hay una caída actual en Render y bloqueantes reproducidos en autenticación SII, firma XML, generación de documentos, montos y RCOF. Las pruebas existentes pasan, pero no cubren varios de estos caminos reales.

## Alcance y límites

- Código local: `b44eb41f0a713affdec6e2dbde343efb58664507`; árbol inicialmente limpio.
- Revisados: controladores públicos, autenticación HMAC, permisos y aislamiento, validación, idempotencia, motor XML/firma, CAF, procesamiento asíncrono, RCOF, webhooks, artefactos, migraciones, despliegue y documentación.
- Render consultado en modo lectura, en el espacio confirmado por el propietario. Servicio `srv-da2bteou01pc73eb6qrg`.
- El último despliegue marcado `live` contiene `49bb9d80c1e4e7826dc4087a9e633886528b4673`, distinto del código local. Los resultados de código de este informe corresponden al checkout local; la caída corresponde a observación directa del servicio.
- Las reproducciones usan datos, certificados y credenciales sintéticos. No se emitieron documentos al SII, no se cargaron CAF reales y no se modificaron servicios ni datos de producción.
- Sin PostgreSQL de pruebas configurado; Docker está instalado, pero su motor no está activo. No se ejecutaron las seis pruebas que requieren PostgreSQL ni se validó el aislamiento RLS real en esta sesión.
- Runtime local disponible: Node `24.19.0`, mientras `package.json` exige Node 22. La compatibilidad exacta con Node 22 queda pendiente.
- Es una auditoría de código y pruebas funcionales acotadas, no una certificación SII, prueba de carga exhaustiva o garantía de ausencia de vulnerabilidades.

## Verificaciones ejecutadas

| Comprobación | Resultado |
|---|---|
| Compilación | Correcta |
| Pruebas unitarias | 93/93; 18 suites |
| Pruebas e2e existentes | 3 aprobadas; 6 omitidas por falta de PostgreSQL |
| Contrato OpenAPI contra baseline | Sin diferencias; 25 rutas |
| Auditoría de dependencias de producción | 7 paquetes clasificados con severidad alta, relacionados con Multer |
| Pruebas HTTP adicionales | 12 casos con controladores reales, validación y HMAC; almacenamiento en memoria y procesamiento SII desactivado |
| XML independiente | `lxml` + `cryptography`, fuera de los validadores del proyecto |
| XSD de facturas | Descargado directamente desde el enlace publicado por el SII |
| URL pública | `/api/v1/health`, `/api/v1/ready` y `/api/v1/dtes`: timeout de 30 s en cada consulta |
| Render | Errores repetidos de conexión a BD y ausencia del worker de Tax API |

## Bloqueantes y hallazgos de prioridad alta

### A01 · Servicio publicado sin conexión a la base de datos

**Observado en Render, prioridad crítica.** Logs del 19-09-2026, aproximadamente 15:20–15:21 UTC, repiten `Unable to connect to the database` y `(ENOTFOUND) tenant/user tax_api_app.wirwadxtrbrslfwayple not found`. El proceso reinicia. Las consultas HTTP no obtuvieron respuesta en 30 segundos.

El registro de despliegue `live` no demuestra que el proceso esté sano actualmente. Debe corregirse y comprobarse la identidad del usuario/proyecto en el pooler; no atribuir el problema a una contraseña sin evidencia adicional.

### A02 · No existe el worker previsto por el proyecto

**Observado en Render, prioridad alta.** El inventario del espacio confirmado no contiene `cmorflow-tax-worker`. La web sigue usando runtime Node y plan gratuito, con `healthCheckPath` vacío, en vez de la configuración Docker definida en `render.yaml`.

El lanzamiento inmediato después del HTTP 202 procesa solamente un trabajo; no sustituye al worker que consulta estados, reintenta y entrega webhooks. El workflow de cron tiene únicamente `workflow_dispatch`, sin horario. No se verificaron disparadores externos ajenos al repositorio. Crear el worker y comprobar su ejecución continua antes de habilitar clientes.

### A03 · Firma XML incompatible con C14N

**Reproducido, prioridad crítica.** `src/infrastructure/framework/sii/signature.engine.ts:173` sustituye la canonicalización XML por expresiones regulares. Conserva elementos autocerrados y no incorpora correctamente el contexto de espacios de nombres.

Verificación independiente: las firmas RSA de los documentos sintéticos 33 y 39 verifican sobre los bytes no normalizados utilizados por el código, pero fallan al verificar `SignedInfo` canonicalizado con C14N. Esto demuestra que el fallo no proviene de una clave de prueba equivocada. Al insertar el DTE en el sobre, también cambia el digest por el namespace heredado.

Reemplazar la firma artesanal por XMLDSig con C14N real y probar documento y sobre en su contexto definitivo. No basta con comprobar que exista una etiqueta `Signature`.

### A04 · Semilla SII y sobre de boleta contienen dos raíces XML

**Reproducido, prioridad crítica.** `signature.engine.ts:141` inserta la firma dentro de la raíz únicamente cuando el identificador es `EnvioDTE`; en los otros casos la concatena después del nodo firmado.

`sii-auth-token.service.ts:42` firma una raíz `Documento` con ID `Semilla`, por lo que produce `Documento` seguido de `Signature` al mismo nivel. Ocurre lo mismo con `EnvioBOLETA`. Ambos archivos fallan el parseo independiente con `Extra content at the end of the document`. Esto bloquea la autenticación real y las boletas antes de discutir su aceptación tributaria.

### A05 · El XSD de facturas incluido es permisivo y oculta XML inválido

**Reproducido, prioridad crítica.** `src/infrastructure/framework/sii/xsd/EnvioDTE_v10.xsd:27` admite contenido arbitrario con `xs:any processContents="lax"`. No es el conjunto completo de esquemas descrito por el SII: faltan `DTE_v10.xsd` y `SiiTypes_v10.xsd`.

El mismo sobre de factura generado por el motor **pasa el XSD local y falla el oficial**. Fallos del motor independientes del CAF sintético: atributo `ID` no permitido en `EnvioDTE`, ausencia de `SubTotDTE` en carátula y ausencia de `TmstFirma` en `Documento`. El fixture también carece de `IDK` en su CAF simulado; ese error específico no se atribuye a un CAF real.

Las boletas también presentan diferencias con el XSD incluido: `RznSoc` frente a `RznSocEmisor`, `TasaIVA` no admitido en ese lugar, ausencia de `SubTotDTE` y `TmstFirma`. El error por falta de firma del sobre en la prueba del archivo **sin firma de sobre** es esperado; los otros errores estructurales son independientes.

Corregir el generador y empaquetar todos los XSD oficiales. La variable `SII_XSD_VALIDATION_ENABLED=true` por sí sola no garantiza validación oficial. Fuente: [formato XML y descarga oficial del SII](https://www.sii.cl/servicios_online/1039-formato_xml-1184.html).

### A06 · El recálculo de la API difiere del documento emitido

**Reproducido por HTTP y motor, prioridad alta.** `integration-request.service.ts:308` calcula sin `pricingMode`, descuento global ni retenciones; `dte-xml.engine.ts:38` sí los aplica al construir el documento.

| Caso, precio de línea $1.190 | Total validado | Total del motor XML |
|---|---:|---:|
| GROSS | $1.416 | $1.190 |
| Descuento global 10%, NET | $1.416 | $1.274 |
| Retención $226 | $1.416 | $1.190 |

Enviar el total correcto de $1.190 con GROSS devuelve HTTP 422. Si se omiten los totales, se acepta una solicitud con un cálculo interno distinto del XML posterior. Además, la documentación promete GROSS por defecto en boletas, pero el cálculo sin opción es NET. Centralizar el cálculo y aplicar el mismo contrato al validar y emitir.

### A07 · El ejemplo de boleta sin receptor falla después del HTTP 202

**Reproducido, prioridad alta.** La guía y el DTO permiten omitir receptor para 39/41. La petición pasa validación y devuelve 202. Sin embargo, `dte-xml.engine.ts:322` ejecuta `input.receiver.businessName.slice(...)` antes de completar un receptor genérico y falla con `Cannot read properties of undefined`.

Completar RUT y nombre genéricos antes de construir TED, encabezado y registro persistente. El fallo ocurre después de la reserva de folio en `EmitDteUseCase.prepare`, por lo que los reintentos pueden consumir folios sin documento terminado.

### A08 · Un hash de BD todavía permite autenticar credenciales cifradas

**Reproducido, prioridad alta.** `integration-credentials.use-case.ts:98` conserva `secretHash = sha256(secret)`. El guard descifra el secreto pero vuelve a usar exactamente `sha256(secret)` como clave HMAC (`integration-hmac.guard.ts:67`).

Una petición firmada solo con el hash persistido fue aceptada por el guard aun cuando la credencial tenía `secretEncrypted`. El cifrado añadido no protege contra suplantación tras una lectura de la tabla de credenciales. No significa que un cliente sin acceso a esa tabla pueda obtener los hashes.

Eliminar el material de firma utilizable en claro de las credenciales nuevas y definir una migración/rotación compatible. Derivar otra clave únicamente a partir del mismo hash público en BD tampoco resuelve el problema.

### A09 · Reserva de folio sin contexto RLS en su transacción

**Hallazgo de código, prioridad alta; pendiente de reproducción con PostgreSQL.** `tenant-config.service.ts:685` abre una transacción y consulta `TenantConfigEntity` sin ejecutar `set_config('app.tenant_id', ...)`. El helper usado en otras operaciones sí establece el contexto, pero esta reserva no lo utiliza.

Con las políticas de `1805200000000-EngineTableRls` y un rol sujeto a RLS, la configuración queda invisible. El contexto CLS de JavaScript no configura la conexión SQL, y el `worker_scope` de la transacción de reclamo ya finalizó. Establecer el tenant en la misma conexión antes del bloqueo del CAF; probar con rol sin BYPASSRLS.

### A10 · Identificador del integrador incompatible con la auditoría UUID

**Hallazgo de código, prioridad alta; pendiente de reproducción con PostgreSQL.** `integration-processor.service.ts:322` pasa `integration:<credentialId>` como `userId`. `emit-dte.use-case.ts:325` lo guarda en `audit_logs.user_id`, declarado UUID en `postgres/entities/audit-log.entity.ts:15`.

Ese valor no es UUID. El guardado ocurre después del envío SII y dentro del grupo de persistencias de la transmisión. Un rechazo de BD puede marcar el documento nuevamente como borrador y programar retransmisión aunque el SII ya lo haya recibido. Guardar la identidad de integración en un campo apropiado y desacoplar fallos de auditoría del resultado de transporte.

### A11 · RCOF pierde su vínculo, no retransmite y usa token fijo

**Tres fallos reproducidos localmente, prioridad alta.**

1. `integration-processor.service.ts:108` guarda `rcofId`, pero inmediatamente llama a `applyState` con el objeto anterior. Ese objeto contiene `rcofId: null`; la actualización posterior lo sobrescribe. Reproducción con resultados desacoplados como en BD: estado `submitted`, `rcofId: null`. El polling lo excluye.
2. `generate-rcof.use-case.ts:73` devuelve un RCOF existente aunque esté `failed` y sin TrackID. Tras simular un timeout, la segunda ejecución devuelve el fallo anterior sin reenviar: contador de transmisiones sigue en 1. El procesador puede anunciar `submitted` sin envío válido.
3. `generate-rcof.use-case.ts:136` consulta el estado con el literal `rcof-poll`, no con un token SII obtenido del certificado.

También se envuelve `ConsumoFolio` como si fuera DTE dentro de `EnvioBOLETA`; revisar ese flujo contra el contrato específico del SII. Los RCOF creados directamente por `rcofDaily()` no generan una solicitud asociada y el polling actual recorre solicitudes, no todos los RCOF pendientes. No se verificó recepción real de RCOF en esta sesión.

### A12 · Idempotencia confunde operaciones diferentes

**Reproducido, prioridad alta.** El hash solo incluye el cuerpo y la búsqueda usa tenant + clave (`integration-request.service.ts:48`). No compara el tipo de operación ni el documento original que figura en la ruta.

Una nota de crédito seguida de una nota de débito con igual body y clave devuelve la primera nota como replay. Lo mismo puede ocurrir entre originales diferentes. Incluir operación y recurso original en la identidad de petición o rechazar explícitamente su reutilización cruzada.

La carrera entre búsqueda y creación tampoco captura la colisión de unicidad para devolver el replay correcto. El filtro de BD busca `23505` dentro del mensaje, en lugar de `driverError.code`, por lo que no garantiza el 409 esperado. Este segundo aspecto se detectó por código, sin concurrencia PostgreSQL en esta sesión.

### A13 · Filtro SSRF incompleto para IPv6

**Reproducido en el clasificador, prioridad alta.** `integration-webhook.service.ts:504` bloquea `::ffff:127.0.0.1` pero no su forma normalizada `::ffff:7f00:1`, que es la que devuelve `new URL(...)`. Tampoco cubre todo el rango link-local: `fe90::1` pasa.

El rechazo de IP se usa tanto al registrar como al conectar. Utilizar normalización de direcciones y comprobación CIDR completas, incluida IPv4 mapeada a IPv6. No se enviaron solicitudes contra servicios internos para demostrar explotación; HTTPS y conectividad condicionan el alcance efectivo.

## Otros defectos que afectan al integrador

| Prioridad | Hallazgo y evidencia |
|---|---|
| Media | Dos descuentos en una misma línea devuelven HTTP 500; deberían producir validación 4xx. Reproducido por HTTP. |
| Media | `pricingMode: "WRONG"` devuelve 202; el DTO solo valida string. Reproducido por HTTP. |
| Media | `exempt: "false"` se transforma en `true` por `@Type(() => Boolean)`. Reproducido; puede cambiar tratamiento tributario de un ítem. |
| Media | Falta un flujo público o CLI completo para crear tenant y guardar perfil tributario. Existe `saveTaxProfile` internamente, pero no ruta para clientes ni script de alta que la invoque; el bootstrap exige tenant preexistente. |
| Media | OpenAPI tiene 28 operaciones, ninguna con requisitos `security` declarados y ninguna con esquema de respuesta. El chequeo contra baseline pasa porque compara dos contratos igualmente incompletos. La protección HMAC en ejecución sí existe. |
| Media | El timeout global de webhook se cancela al recibir cabeceras, antes de leer `response.text()`, y el límite de snippet se aplica después de leer todo. Un cuerpo lento continuo o enorme puede retener el worker/consumir memoria; `bodyTimeout` no equivale a límite total de duración o tamaño. Hallazgo de código. |
| Media | Evento webhook y cambio de estado no son una única operación durable. Si falla crear el evento después de guardar el estado, se captura el error y no se ve un mecanismo que reconstruya ese evento perdido. Hallazgo de código. |
| Media | El polling solo busca `submitted`; `observed` tiene transiciones futuras permitidas pero deja de consultarse. Definir si es estado final o continuar su reconciliación. |
| Media | Dependencias: `npm audit --omit=dev` reporta 7 paquetes afectados por la cadena Multer. No son siete fallos independientes ni se probó su explotación: no se encontraron interceptores multipart en los controladores actuales. Actualizar de forma compatible y volver a auditar. [Aviso primario de Express](https://expressjs.com/en/blog/2026-08-31-security-releases/). |
| Media | La garantía de un solo folio no abarca caídas entre reserva, creación de DTE y vínculo con solicitud; son operaciones separadas. Falta prueba real de recuperación tras caída. |
| Baja | Rate limit por credencial en memoria: se multiplica con varias instancias y se reinicia al arrancar. |
| Baja | `/ready` prueba conexión y algunas variables, pero no worker, migraciones, binario XSD, configuración tributaria ni aceptación SII. Puede indicar listo sin capacidad efectiva de emitir. |
| Baja | El código de auditoría atribuye por defecto emisiones a nombres/RUT de ejemplo heredados; debe registrar el actor real de la integración. |

## Lo que sí funcionó en las comprobaciones

- Petición HMAC válida: HTTP 202; sin cabeceras: 401.
- Lectura de solicitud propia: 200; lectura desde otro tenant: 404 en el harness HTTP.
- Replay secuencial con igual body: 202 y mismo requestId; cambio de body: 409.
- `tenantId` inyectado en el cuerpo: 400 por whitelist; el e2e existente también rechaza header tenant contradictorio.
- Pruebas existentes de nonce, permisos, enlaces firmados, cifrado, SSRF básico, estados y PDF pasan dentro de sus mocks y fixtures.
- No se observó exposición pública de XML/PDF en el diseño de descarga: las rutas exigen HMAC o token firmado con vencimiento.

Estos resultados no verifican persistencia RLS real ni emisión tributaria completa: el harness HTTP detiene el procesamiento y utiliza memoria.

## Reproducción y evidencia guardada

Desde la raíz del repositorio:

```text
npm run build
npm test -- --runInBand
npm run test:e2e -- --runInBand
npm run openapi:check
npm audit --omit=dev --json
node scripts/audit-2026-09-19.cjs
node scripts/audit-http-2026-09-19.cjs
curl.exe -L https://www.sii.cl/servicios_online/docs/xml/schema_dte.zip -o coverage/audit-2026-09-19/schema_dte.zip
python scripts/audit-xml-2026-09-19.py
```

Python requiere `lxml` y `cryptography`. Los scripts escriben fixtures sintéticos y resultados en `coverage/audit-2026-09-19`, ignorado por Git. La evidencia resumida está en `EVIDENCIA-2026-09-19.json`. Los scripts son reproducciones diagnósticas: su exit code 0 significa que finalizaron, no que el producto esté sano. No sustituyen pruebas de regresión con expectativas de funcionamiento correcto.

## Orden recomendado de corrección y criterio de aceptación

1. Recuperar conexión a BD y comprobar `/ready`; habilitar worker y health check en el despliegue revisado.
2. Corregir semilla, firma y estructura de XML; hacer que todos los tipos anunciados pasen XSD oficial y verificación criptográfica independiente.
3. Corregir transacciones RLS, actor UUID, montos y receptor de boletas antes de emitir datos reales.
4. Corregir ciclo RCOF, idempotencia, protección de hashes y direcciones privadas.
5. Completar alta de clientes, contrato de respuestas y pruebas HTTP/DB de todos los endpoints.
6. Ejecutar con Node 22 y PostgreSQL real sin privilegios de bypass; probar fallos de red, reinicios y concurrencia. Después realizar el circuito de certificación SII con material autorizado, desde alta/configuración hasta estado final, XML/PDF y webhook.

**Criterio de salida:** no basta con un 202, un build verde o un deploy `live`. Debe demostrarse un documento aceptado en el ambiente SII correspondiente y una recuperación correcta ante fallos, sin duplicar folios ni cambiar montos. Esta auditoría deja el diagnóstico y evidencia; no aplicó correcciones funcionales ni cambios de infraestructura.
