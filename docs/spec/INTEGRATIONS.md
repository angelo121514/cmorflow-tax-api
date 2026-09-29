# Integraciones externas

## Servicio de Impuestos Internos (SII)

- **Propósito/uso:** autenticación del contribuyente, transmisión de DTE y RCOF, consulta de TrackID. Se usa en SiiAuthTokenService, SiiSoapClient, QueryDteStatusUseCase, GenerateRcofUseCase y EmitDteUseCase.
- **Protocolo:** modo mock o real; semilla/token SOAP, upload multipart, XML ISO-8859-1. Boletas tienen upload diferenciado. Modo real necesita SII_UPLOAD_RCOF_URL para RCOF.
- **Credenciales/configuración:** certificado PFX/P12 y contraseña por tenant; material sensible cifrado con AES-256-GCM y SII_MASTER_KEY. Token temporal cacheado por tenant hasta 110 min. Configuración incluye SII_INTEGRATION_MODE, SII_ENVIRONMENT, SII_MASTER_KEY, SII_*_URL y timeout; varios overrides no aparecen en .env.example.
- **Reintentos:** HTTP reintenta errores de conexión/timeout hasta 3 intentos, esperas 500 ms y 1 s; errores HTTP de negocio no se reintentan ahí. Processor programa reintentos 1m, 5m, 15m, 1h y 6h, con máximo 5 intentos.
- **Errores:** errores HTTP/SOAP, timeout, ausencia de TrackID, firma/XSD inválido, certificado o token. Clasificación de negocio y recuperación por processor/reconciliador.
- **Validación externa:** el código no demuestra aceptación real, validez de certificados productivos ni vigencia de URLs; requiere certificación humana/tributaria.

## PostgreSQL / Supabase

- **Propósito:** documentos, solicitudes, idempotencia, configuración, secretos cifrados, eventos, auditoría y cola.
- **Configuración:** DB_HOST/PORT/USER/PASSWORD/NAME/SCHEMA, DB_SSL y DB_SSL_REJECT_UNAUTHORIZED. Producción exige DB_SSL=true y verificación TLS habilitada.
- **TLS:** certs/supabase-root-ca.crt y certs/README.md describen confianza TLS; no incluyen credenciales de usuario. No se conectó a DB remota.
- **Aislamiento:** repositories y RLS tenant/worker. Policies/grants reales del ambiente son desconocidos.
- **Errores/reintentos:** transacciones/constraints; no se observa política general de retry de DB. Procesador clasifica fallos capturados de emisión como recuperables.

## Webhooks a consumidores

- **Configuración:** HTTPS, eventos permitidos y descripción. Genera secreto whsec_, lo devuelve en registro y lo cifra para uso posterior.
- **Firma:** X-CmorFlow-Signature: sha256=HMAC(secret, timestamp + '.' + body), además de Event-Id, Event-Type y Timestamp. HTTP 2xx marca entrega exitosa.
- **Protección:** bloquea redes no unicast, redirects, fija IP resuelta mediante dispatcher y aplica timeout 10 s.
- **Reintentos:** 1m, 5m, 15m, 30m, 1h, 6h, máximo seis; agotados pasan a dead. Redelivery manual crea nuevas entregas.
- **Límites:** no hay consumidores específicos identificados ni contratos externos verificados.

## Render, GitHub Actions y Prometheus

- **Render:** Blueprint define API, worker y migración pre-deploy Docker. Variables de grupo referidas en render.yaml; estado desplegado desconocido.
- **GitHub Actions:** CI en push/PR a main, Node 22 y Postgres 16; build, suites unit/e2e, OpenAPI, Prettier y Docker. Workflow cron solo workflow_dispatch y requiere secretos CRON_HMAC_SECRET/CRON_API_BASE_URL.
- **Prometheus:** /api/v1/metrics; en producción requiere feature flag y bearer. Reglas de alerta en docs/monitoring/prometheus-alerts.yml.

## Servicios no encontrados

No se encontraron clientes para pagos, correo, LLM, Redis, buckets, Shopify o WooCommerce. README/guía los presentan como posibles consumidores, no integraciones implementadas.
