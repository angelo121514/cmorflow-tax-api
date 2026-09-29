# Reportar vulnerabilidades

Esta política se aplica a CmorFlow Tax API. Las reglas técnicas de autenticación y aislamiento se describen en [docs/spec/SECURITY.md](docs/spec/SECURITY.md).

## Canal de reporte

Usa Security → Report a vulnerability en GitHub cuando el repositorio tenga habilitados los reportes privados. Si la opción no aparece, solicita al mantenedor un canal privado; un issue público puede pedir ese canal sin incluir detalles del fallo.

No publiques credenciales, certificados PFX, llaves CAF, datos tributarios de clientes ni instrucciones de explotación en un issue público.

## Información útil

En el canal privado indica la revisión afectada, entorno, pasos mínimos con datos sintéticos, comportamiento esperado/observado e impacto posible. Describe si afecta autenticación, aislamiento entre tenants, firma, persistencia o entrega de documentos. Nunca pruebes contra tenants o infraestructura de terceros sin autorización.

## Soporte y seguimiento

La revisión mantenida es main. El proyecto está en desarrollo y la certificación tributaria sigue su propio proceso; no se promete soporte para versiones antiguas ni un plazo fijo de respuesta.

El mantenedor acusa recibo, reproduce con datos sintéticos, coordina la corrección y acuerda la divulgación con quien reporta. Antes de abrir el repositorio, habilita el canal privado según [RELEASING.md](docs/maintainers/RELEASING.md).
