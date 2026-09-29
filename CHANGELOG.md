# Changelog

Este archivo registra cambios visibles para integradores y mantenedores. Las decisiones y criterios detallados se guardan en docs/spec/changes/.

## Unreleased

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
- Resultados de PostgreSQL 16 y build de imagen deben confirmarse en un entorno disponible; esta entrada no equivale a una versión publicada.
