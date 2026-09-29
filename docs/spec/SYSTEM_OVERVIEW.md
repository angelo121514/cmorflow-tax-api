# Panorama del sistema

## Alcance y confianza

Esta especificación describe el checkout local observado en la rama main, commit b44eb41, y los cambios locales que estaban presentes durante el análisis. No equivale a una inspección del despliegue activo. El árbol tenía 76 entradas modificadas o no rastreadas antes de crear esta carpeta; esta auditoría agrega archivos únicamente en docs/spec y conserva el resto.

Convenciones:

- **CONFIRMADO:** lo demuestra el código, la configuración, el esquema, las pruebas o la documentación.
- **INFERIDO:** explicación compatible con varias evidencias, sin contrato explícito.
- **DESCONOCIDO / requiere validación:** depende de sistemas externos, datos de producción o flujos que no están en este checkout.

## Propósito y problema

**CONFIRMADO:** README define CmorFlow Tax API como servicio B2B para exponer facturación electrónica chilena por REST, permitiendo que ERP, POS, comercio electrónico u otros SaaS soliciten DTE, RCOF y artefactos sin consumir el ERP completo. El código materializa solicitudes de emisión en PostgreSQL y las procesa mediante un reconciliador; integra firma XML, CAF, certificados y transmisión/consulta de estado ante el SII.

**INFERIDO:** busca separar el motor tributario del ERP y ofrecerlo como servicio multiempresa. No se encuentra una interfaz web ni una aplicación cliente en este repositorio.

## Actores

| Actor                    | Evidencia y capacidad                                                                                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sistema integrador       | Envía solicitudes firmadas con credencial API; consulta estado y descarga artefactos. README nombra ERP, POS y SaaS; clientes concretos en producción: desconocido. |
| Administrador del tenant | Usa credencial HMAC con permisos de gestión para credenciales, webhooks y configuración tributaria/visual.                                                          |
| Worker/reconciliador     | Reclama solicitudes, consulta SII, entrega webhooks, purga nonces y genera RCOF diario.                                                                             |
| SII                      | Sistema externo para autenticación, recepción de DTE/RCOF y consulta de TrackID.                                                                                    |
| Operador de plataforma   | Configura secretos, base de datos y despliegue. No se encontró una ruta pública de alta de tenant.                                                                  |

## Módulos principales

- **HTTP/API:** NestJS, controladores REST bajo /api/v1, validación DTO, Swagger/OpenAPI, filtro global de errores, Helmet, CORS y throttling.
- **Integraciones B2B:** HMAC, credenciales, permisos, solicitudes idempotentes, cola durable en Postgres, reintentos, reconciliación, RCOF, webhooks y enlaces firmados a artefactos.
- **Motor SII/DTE:** perfil tributario por tenant, gestión de CAF y certificados, reserva de folio, cálculo de importes, XML, TED, XMLDSig, XSD opcional, PDF A4 y cliente SOAP/multipart.
- **Persistencia:** TypeORM/PostgreSQL; repositorios tenant-scoped, políticas RLS y datos de tenant/configuración.
- **Worker/operación:** proceso Node separado, endpoints internos HMAC de respaldo, migrador de base, métricas Prometheus y alertas.

No hay frontend, Redis, BullMQ, almacenamiento de objetos ni broker de mensajes implementado en el checkout observado. La cola es la tabla integration_requests.

## Tecnologías y dependencias externas

**CONFIRMADO:** Node.js >=22.12.0 <23 según package.json y Node 22.12 en Docker; TypeScript 5.9; NestJS 11; TypeORM 0.3; PostgreSQL; pg; xml-crypto; node-forge; fast-xml-parser; pdfkit; sharp; prom-client; Winston; undici; Jest y Supertest.

Servicios/infrastructura descritos: PostgreSQL/Supabase, SII (certificación o producción), Render con Docker, GitHub Actions como disparador manual de cron de respaldo y un scraper Prometheus. Los webhooks llaman a URLs HTTPS aportadas por tenant. No se verificó conectividad ni credenciales de estos servicios.

## Flujo general de información

1. Integrador firma método, ruta, body, timestamp y nonce y envía una operación REST.
2. Guard autentica, consume nonce, aplica rate limit y permisos, y obtiene el tenant desde credencial.
3. API valida DTO y reglas tributarias, recalcula importes y persiste solicitud queued; emisión y RCOF contestan 202.
4. Worker u operación de respaldo reclama trabajo durable. DTE: prepara XML y folio, persiste el documento y transmite al SII. RCOF: consolida boletas, firma, persiste y transmite.
5. Reconciliador consulta TrackID y actualiza estados. Cambios notificables crean eventos y entregas webhook.
6. Integrador reconcilia mediante GET; descarga XML/PDF con HMAC o URL firmada de cinco minutos.

## Arquitectura actual

**CONFIRMADO:** aplicación NestJS modular, con módulos de integración, emisión DTE, SII, servicios de datos, controladores y logging. API, migración y worker se arrancan por separado. La configuración de producción exige DB SSL, modo SII real, XSD activado y secretos no placeholder. Migraciones se ejecutan en despliegue o por comando independiente; sincronización de TypeORM está desactivada en producción.

**DESCONOCIDO:** disponibilidad, número de instancias y configuración real de Render; tenants y certificados cargados; estado actual de certificación; volumen y SLA. docs/audit/AUDITORIA-2026-09-19.md registra observaciones de ese día, no prueba el estado actual.

## Evidencia principal

README.md, package.json, src/app.module.ts, src/main.ts, src/worker.ts, src/application/integrations/, src/application/dte/, src/infrastructure/framework/sii/, src/infrastructure/framework/postgres/, Dockerfile y render.yaml.
