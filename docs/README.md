# Documentación del proyecto

## Para empezar

- [README del proyecto](../README.md): finalidad, instalación y ejecución.
- [CONTRIBUTING.md](../CONTRIBUTING.md): cómo implementar y revisar cambios.
- [Guía de integración](integrations/GUIDE.md): HMAC, emisión, estados, artefactos y webhooks.
- [Índice de especificaciones](spec/SPEC_INDEX.md): mapa de features, código y pruebas.

## Especificación actual

- [Visión del sistema](spec/SYSTEM_OVERVIEW.md) y [arquitectura](spec/ARCHITECTURE.md).
- [Features](spec/FEATURES.md), [reglas de negocio](spec/BUSINESS_RULES.md) y [flujos](spec/USER_FLOWS.md).
- [API](spec/API_SPEC.md), [dominio](spec/DOMAIN_MODEL.md) y [persistencia](spec/DATA_MODEL.md).
- [Seguridad técnica](spec/SECURITY.md) e [integraciones](spec/INTEGRATIONS.md).
- [Decisiones y bloqueos](spec/DECISIONS.md), [deuda con responsables](spec/TECHNICAL_DEBT.md) y [provisioning](spec/TENANT_PROVISIONING.md).

## Cambios y evidencia

- [Trazabilidad](spec/TRACEABILITY.md): enlaces verificables desde feature hasta código y tests.
- [Plantilla de cambio](spec/CHANGE_TEMPLATE.md): copiar a spec/changes/.
- [Pruebas y resultados](spec/TESTING.md): distinguir tests ejecutados, omitidos y evidencia SII.
- [Changelog](../CHANGELOG.md): cambios aún sin publicar y futuras versiones.
- [Preparar una versión](maintainers/RELEASING.md): Git, CI y configuración del repositorio.

Los informes bajo audit/ y la auditoría inicial en spec/AUDIT_REPORT.md son registros históricos. Para conocer el estado vigente, consulta decisiones, deuda y resultados fechados; un hallazgo histórico puede estar resuelto.
