# Changelog

Este archivo registra cambios visibles para integradores y mantenedores. Las decisiones y criterios detallados se guardan en docs/spec/changes/.

## Unreleased

### Seguridad y recuperación — 2026-10-14

- Sustituye node-forge por Node crypto/OpenSSL; actualiza dependencias y runner Jest.
- Reserva, DTE y vínculo atómicos; mutaciones de configuración conservan folios y rechazan CAF superpuestos.
- Estado y eventos/entregas forman una outbox transaccional; envíos SII ambiguos requieren conciliación sin retransmisión automática.
- Migración añade transmission_started_at; aplicar antes del worker. No admite rollback que pierda ese marcador.
- XSD SII y CA Supabase ahora se proveen externamente; montar recursos antes de actualizar en entornos reales. Docker incluye OpenSSL.
- CLI tenant:provision para una base independiente; bootstrap usa RLS y transacción.


### MIT y alineación SDD — 2026-10-13

- Código original bajo MIT; avisos separados para recursos externos.
- Constitución, modelo de amenazas, comparación SDD, tareas y estado de implementación.
- CI verifica documentos obligatorios, enlaces locales y seguimiento completo de tareas.
- Sin cambios de HTTP, esquema, tipos públicos ni reglas tributarias.

### Organización y contribución

- Flujo SDD por PR con fichas de cambio, referencias verificables y cobertura del diff en CI.
- Guías de contribución, reporte de vulnerabilidades, conducta y preparación de versiones.
- Plantillas para bugs, propuestas y pull requests.
- Protección de archivos locales de entorno y material privado en Git y en el contexto Docker.

### Contrato

- Respuestas explícitas para carga de CAF, firma y stock de folios; stock es una lista de objetos.
- Validación OpenAPI rechaza respuestas genéricas y referencias de respuesta inexistentes.

### Base SDD anterior

- Seguimiento de solicitudes observed, RCOF diario durable, resolución de conflictos concurrentes de idempotencia y permisos administrativos de webhooks.
- Respuestas webhook con lectura limitada y timeout durante consumo.

### Auditoría previa a subir cambios

- Recuperación del estado de RCOF persistido antes de consolidar la solicitud.
- Credenciales HMAC v2 sin secreto cifrado se rechazan sin degradar a v1.
- Migración base con timestamp válido de TypeORM; rollback destructivo automático bloqueado para proteger tablas compartidas.
- Parches de Undici y js-yaml; CI comprueba avisos de severidad alta en dependencias de producción.

### Validaciones pendientes

- Confirmación tributaria de T46, procedimiento operativo de tenants y evidencia SII.
- CI aprobó PostgreSQL 16 y el build de imagen; esta entrada no equivale a certificación SII ni a una versión publicada.
