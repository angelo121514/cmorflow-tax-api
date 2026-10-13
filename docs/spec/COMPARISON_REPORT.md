# Comparación SDD

Inspección de GitHub y fuente el 2026-10-13. Referencias fijadas: Cmor-protocol-flow `39ef20305ccca0a3f83a5fee962013d8bff3a4e2`; SaaS-Restaurantes- `d4e3bd6dd1f4495b896c85c6a3be7d5d7231492a`; Tax API `a2aef05c739e71e5a65b0a100b7ae38f184cad03`.

El autor confirmó ambos proyectos de referencia. Cmor-protocol-flow es público MIT; el segundo es privado con MIT. Sólo se publica esta comparación de capacidades, sin reproducir código, datos ni contenido privado. Se inspeccionaron inventarios docs/spec, manifiestos y constitución; no se ejecutaron sus suites ni se afirma auditoría completa de esos proyectos.

| Capacidad                                           | Cmor-protocol-flow                        | SaaS-Restaurantes-                        | Tax API antes → esta entrega                                           |
| --------------------------------------------------- | ----------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------- |
| Specs de dominio/API/datos/seguridad y trazabilidad | Presente en inventario                    | Presente en inventario                    | Presente → conservada                                                  |
| Constitución técnica y de seguridad                 | Presente, distingue observado y propuesto | Presente, distingue observado y propuesto | Ausente → incorporada y adaptada a HMAC/SII                            |
| Modelo de amenazas                                  | Presente en inventario                    | Presente en inventario                    | Ausente → incorporado                                                  |
| Plan, tareas y estado de implementación             | Presente en inventario                    | Presente en inventario                    | Parcial, deuda/decisiones existentes → documentos explícitos enlazados |
| Informe de validación                               | Presente en inventario                    | Presente en inventario                    | Parcial, TESTING/auditorías → informe de esta entrega                  |
| Checker documental                                  | test:docs declarado                       | test:docs declarado                       | sdd:test/check existente → ampliado                                    |
| Cobertura del diff con fichas en CI                 | No evaluada en esta comparación           | No evaluada en esta comparación           | Presente, conservada                                                   |
| Licencia MIT                                        | Presente                                  | Presente; repo privado                    | Ausente → incorporada al código original                               |

Conclusión: SDD ya estaba aplicado a Tax API, con enforcement propio. La alineación completa las capacidades documentales observadas; no exige copiar tecnologías ni estructuras exclusivas de restaurantes. La base fue reconstruida sobre código existente, por lo que no demuestra desarrollo desde cero guiado por specs. Comparación no equivale a certificación de madurez o seguridad.
