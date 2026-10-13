# Constitución técnica

Adoptada para cambios futuros el 2026-10-13. Baseline observado: a2aef05. Las specs describen AS-IS; estas normas expresan obligaciones para cambios nuevos, no cumplimiento retroactivo ni certificación SII.

| ID      | Norma                                                                                   | Evidencia o límite actual                                               |
| ------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| SEC-001 | Denegar ante credencial o autorización inválida; tenant deriva de credencial            | [Seguridad](SECURITY.md), F-07                                          |
| SEC-002 | Mantener aislamiento por tenant en HTTP, worker, artefactos y DB                        | [Trazabilidad](TRACEABILITY.md); RLS e2e no cubre todas las rutas       |
| SEC-003 | No incorporar secretos, PFX/CAF privados ni PII real en repo, logs o fixtures           | [Contribución](../../CONTRIBUTING.md); repo:check sólo controla nombres |
| SEC-004 | Validar entradas y respuestas externas; webhooks con autenticidad, límites y permisos   | [Amenazas](THREAT_MODEL.md), F-08                                       |
| NFR-001 | Preservar idempotencia e integridad de folios; fallos parciales se explicitan           | [Deuda](TECHNICAL_DEBT.md), TASK-001/002/003 pendientes                 |
| NFR-002 | Mantener contrato HTTP y compatibilidad; cambios explícitos en spec y baseline          | [API](API_SPEC.md), OpenAPI sin drift                                   |
| NFR-003 | No afirmar certificación ni cambiar reglas bloqueadas sin evidencia tributaria          | [Decisiones](DECISIONS.md), D-006/D-007                                 |
| NFR-004 | Cada cambio relevante incluye spec, criterios, código, pruebas o exención concreta y CI | [Plan](PLAN.md), checker estructural más revisión humana                |

Excepciones: documentar motivo, alcance, responsable y fecha de revisión en una ficha antes de implementar. No resolver por excepción los bloqueos tributarios externos. Definition of Done: criterios comprobados, CI aprobado, riesgos y resultados reales registrados; [estado](IMPLEMENTATION_STATUS.md) distingue implementado, validado y pendiente.
