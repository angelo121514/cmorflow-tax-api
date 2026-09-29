# Catálogo de funcionalidades existentes

Los flujos describen el código actual. Los errores concretos pueden variar entre IntegrationApiException, validación Nest y excepciones HTTP genéricas.

## F-01 — Emitir DTE

- **Objetivo:** aceptar una solicitud de emisión y después crear/firmar/transmitir un documento chileno.
- **Actor:** integrador con permiso dte:emit.
- **Precondiciones:** feature flag INTEGRATIONS_API_ENABLED=true; credencial activa, no expirada y con permisos; tenant previamente provisionado; CAF, firma y perfil tributario adecuados en modo real; Idempotency-Key no vacío.
- **Flujo principal:** controller valida DTO; servicio valida tipo/datos y recalcula importes; persiste integration_request queued y snapshot 202; hace kick de un trabajo; worker prepara DTE, reserva folio, cifra/configura CAF, genera y firma XML, guarda DTE y vincula dteId; transmite al SII y avanza a submitted; poller consulta estado final.
- **Alternos:** replay exacto devuelve snapshot; falla de red se reintenta; error SII se refleja como estado/error; si falta DTE el GET devuelve 404.
- **Errores conocidos:** API_DISABLED 404, auth/permisos 401/403, rate limit 429, IDempotency-Key requerido 400, conflictos 409, tributarios 422, configuración/CAF/folio/certificado, SII_UNAVAILABLE.
- **Datos:** tenant, credential, integration_request, dte_document, sii_submission, audit_log.
- **API/código:** POST /api/v1/dtes; DtesController, IntegrationRequestService, IntegrationProcessorService, EmitDteUseCase, CAFEngine, DteXmlEngine, SignatureEngine.
- **Tests:** integration-request.service.spec, integration-processor.service.spec, emit-dte.use-case.spec, guards, DTO tests; el test PostgreSQL cubre RLS/idempotencia.

## F-02 — Emitir notas de crédito y débito

- **Objetivo:** crear documento 61 o 56 referenciado al DTE original.
- **Actor:** integrador dte:emit.
- **Precondiciones:** original pertenece al tenant y tiene XML recuperable; key presente; detalle/motivo válido.
- **Flujo principal:** lee original, extrae receptor/tipo/folio/fecha XML, arma referencias, recalcula totales y encola como credit-note/debit-note con resourceKey igual al original.
- **Alternos:** mismo key/body/recurso reusa solicitud; original ajeno o inexistente devuelve NOT_FOUND.
- **Errores:** mismos de emisión más referencia ausente o payload inválido.
- **Datos:** integration_request y dte_document original/nuevo.
- **API/código:** POST /api/v1/dtes/{dteId}/credit-notes (61), debit-notes (56); DtesController.emitNote y IntegrationRequestService.
- **Tests:** validación de notas y processing genérico en integration-request.service.spec / integration-processor.service.spec. No se encontró test de controller por cada ruta.

## F-03 — Consultar estado y reconciliar solicitud

- **Objetivo:** entregar estado público, datos DTE/RCOF y enlaces de recursos.
- **Actor:** integrador dte:read o rcof:read.
- **Precondiciones:** credencial HMAC y tenant correspondiente.
- **Flujo principal:** por requestId/DTE ID busca integration_request; por referencia externa resuelve request; arma snapshot consolidando DTE/RCOF, folio, estado interno, TrackID, error, intentos y timestamps.
- **Alternos:** GET DTE puede buscar por dteId; GET RCOF puede hallar la request o la submission.
- **Errores:** externalReference falta 400; recurso no encontrado/ajeno 404.
- **Datos:** integration_requests, dte_documents, rcof_submissions.
- **API/código:** GET /dtes?externalReference=..., GET /dtes/{id}, GET /rcof/{id}; IntegrationRequestService.buildStatus.
- **Tests:** estado consolidado en integration-request.service.spec; e2e HMAC; no cobertura de contrato completa en OpenAPI.

## F-04 — Obtener XML/PDF y enlaces temporales

- **Objetivo:** entregar artefactos privados asociados a DTE.
- **Actor:** credencial con artifacts:read o consumidor que posea token firmado.
- **Precondiciones:** DTE pertenece al tenant; token de enlace no expiró para ruta pública.
- **Flujo principal:** descarga XML almacenado; PDF se reconstruye desde XML/modelo de impresión y perfil visual snapshot; URLs expiran a los 300 s y se sirven desde endpoint público tokenizado.
- **Alternos:** PDFs de DTE históricos sin snapshot usan marca neutral; logo/brand faltante puede fallar.
- **Errores:** NOT_FOUND 404 por recurso/token/expiración; error interno al faltar perfil asociado.
- **Datos:** dte_documents, tenants, invoice_brand_profiles.
- **API/código:** GET /dtes/{dteId}/xml, GET /pdf, POST /artifact-links, GET /artifacts/{token}; IntegrationArtifactsService, PdfGenerator, ArtifactsController.
- **Tests:** integration-artifacts.service.spec y pdf.generator.spec.

## F-05 — Solicitar y generar RCOF

- **Objetivo:** consolidar consumo de folios de boletas 39/41 por fecha y enviarlo al SII.
- **Actor:** API rcof:submit; worker para la generación diaria.
- **Precondiciones:** fecha ISO; RCOF con boletas emitidas de ese día; configuración/firma adecuada; URL de upload en modo real.
- **Flujo principal manual:** encola request 202; processor invoca GenerateRcofUseCase; consolida folios/importes, construye/firma XML, persiste unique tenant/fecha/sequence y transmite; posterior polling consulta TrackID.
- **Flujo diario:** worker obtiene fecha de ayer en America/Santiago; enumera tenants y encola una `integration_request` con key determinista por fecha/secuencia. El processor/poller estándar transmite, consulta y recupera el flujo al reiniciar.
- **Alternos:** submission existente con TrackID/estado final se reutiliza; submission fallida sin TrackID se vuelve a transmitir; sin boletas 422 en operación manual.
- **Errores:** VALIDATION_ERROR, falta de firma/config, envío SII fallido y reintentos de request.
- **Datos:** dte_documents, rcof_submissions, integration_requests (manuales y diarios), tenant_configs, audit/métricas.
- **API/código:** POST /rcof, GET /rcof/{id}; cron /internal/cron/rcof-daily; GenerateRcofUseCase y IntegrationOrchestratorService.
- **Tests:** generate-rcof.use-case.spec, processor/orchestrator specs, incluyendo RCOF diario durable y recuperación observada. No test operacional con SII real.

## F-06 — Configurar credenciales de emisión

- **Objetivo:** guardar CAFs y certificado PFX para autorizar folios y firmar.
- **Actor:** admin con credentials:write/read.
- **Precondiciones:** tenant/credencial admin existentes.
- **Flujo principal:** carga XML CAF; service valida/parsea y cifra material; guarda certificado/contraseña cifrados; consulta folios y stock.
- **Alternos:** puede tener múltiples CAF por tipo; reserva busca el primer rango no agotado.
- **Errores:** DTO inválido, CAF mal formado, certificado/clave inválido, master key no segura, folios agotados.
- **Datos:** tenant_configs.config_json y audit si se registra acción.
- **API/código:** POST /configuration/caf, POST /configuration/signature, GET /configuration/folios; TenantConfigController, TenantConfigService, CafService, Aes256Cipher.
- **Tests:** caf.service.spec, tenant-config related specs, runtime config. No hay ruta pública observada para crear tenant o guardar tax profile.

## F-07 — Administrar credenciales HMAC

- **Objetivo:** crear, listar, rotar y revocar llaves de integración.
- **Actor:** credencial con credentials:read/write.
- **Precondiciones:** credencial admin operativa; master key para nuevas credenciales.
- **Flujo principal:** create emite keyId/secret y persiste hash + ciphertext; list enmascara; rotate crea nuevo key con mismas perms y limita anterior hasta 24 h; revoke cambia estado, preservando última admin activa.
- **Alternos:** expiración se calcula opcionalmente en días.
- **Errores:** permiso inválido, nombre vacío, tipo api con permisos admin (incluye `webhooks:read`), not found, self/last-admin revoke.
- **Datos:** integration_credentials, nonces, audit_logs.
- **API/código:** POST/GET /credentials, POST /credentials/{id}/rotate|revoke; IntegrationCredentialsUseCase.
- **Tests:** integration-credentials.use-case.spec, HMAC guard y e2e.

## F-08 — Webhooks salientes

- **Objetivo:** notificar transiciones DTE/RCOF a integradores.
- **Actor:** administrador con webhooks:read/write; worker para entregas.
- **Precondiciones:** endpoint HTTPS público, evento permitido, master key.
- **Flujo principal:** registro genera y muestra secreto una vez; transiciones crean evento+delivery para endpoints suscritos; worker firma payload, POST, guarda respuesta y reintenta.
- **Alternos:** redelivery manual crea entregas nuevas; endpoint desactivado no recibe.
- **Errores:** HTTPS/evento inválido, DNS privado/no resoluble, timeout, respuesta no 2xx, secreto/DB falla.
- **Datos:** endpoints, events, deliveries.
- **API/código:** POST/GET /webhooks, deactivate, redeliver, GET /deliveries; IntegrationWebhookService, IntegrationStateService.
- **Tests:** integration-webhook.service.spec cubre registro, emisión, HMAC, fallos y redelivery.

## F-09 — Marca visual de PDF

- **Objetivo:** configurar logo/colores y conservar diseño histórico.
- **Actor:** administrador con credentials:read/write.
- **Precondiciones:** payload incluye logo (objeto o null), colores válidos.
- **Flujo principal:** verifica MIME/contenido, límites, normaliza imagen PNG, crea versión inmutable, la activa y audita; cada nuevo DTE fija perfil activo.
- **Alternos:** GET logo devuelve PNG o 404; salida PDF sin perfil usa neutral solo cuando no existe snapshot histórico.
- **Errores:** formato/base64/dimensiones/color/contraste no válido; perfil activo ausente.
- **Datos:** invoice_brand_profiles, tenant_configs.activeBrandProfileId, dte_documents.brand_profile_id.
- **API/código:** GET/PUT /configuration/branding, GET /branding/logo; InvoiceBrandingService y PdfGenerator.
- **Tests:** invoice-branding.service.spec, tenant-config.service.branding.spec, emit-dte.use-case.spec, pdf.generator.spec.

## F-10 — Salud, operación y métricas

- **Objetivo:** comprobar proceso/DB/config y permitir scraping/mantenimiento.
- **Actor:** plataforma; crons internos firmados; scraper de métricas.
- **Precondiciones:** ruta health pública; ready consulta Postgres. Cron requiere CRON_HMAC_SECRET. Producción metrics requiere bearer.
- **Flujo principal:** liveness responde ok; readiness devuelve checks Postgres/feature/master-key; reconciler cron procesa lote, webhooks o RCOF diario; métricas exponen registry Prometheus.
- **Alternos/errores:** readiness 503 cuando DB/master key no aptos; guard cron 401 por headers/firma/nonce; métricas prod 401 sin autorización.
- **Datos:** cron_nonces, tablas de cola/entregas, contadores/gauges.
- **API/código:** GET /health, /ready, /metrics; POST /internal/cron/*; HealthController, MetricsController, CronController, IntegrationOrchestratorService.
- **Tests:** app-boot.e2e, runtime-config.e2e, cron-hmac guard, metrics controller; postgres.e2e para DB/RLS.
