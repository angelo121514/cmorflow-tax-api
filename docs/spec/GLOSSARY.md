# Glosario

| Término             | Significado en este proyecto                                                                                                                                                  |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CAF                 | Código de Autorización de Folios del SII; delimita folios y contiene datos criptográficos para timbre/TED.                                                                    |
| DTE                 | Documento Tributario Electrónico chileno: factura, boleta, guía, nota de crédito/débito, entre otros tipos soportados.                                                        |
| TED                 | Timbre Electrónico del DTE asociado a autorización CAF.                                                                                                                       |
| RCOF                | Reporte de Consumo de Folios de boletas; sistema agrega boletas por fecha y tipo.                                                                                             |
| SII                 | Servicio de Impuestos Internos de Chile.                                                                                                                                      |
| TrackID             | Identificador asignado por SII a envío para consultar procesamiento.                                                                                                          |
| Tenant              | Empresa/contribuyente aislado en los datos de esta API.                                                                                                                       |
| Credencial API      | Llave cmor_live_* usada por sistema integrador.                                                                                                                               |
| Credencial admin    | Llave cmor_admin_* para gestión de credenciales/configuración/webhooks.                                                                                                       |
| HMAC                | Firma de request con secreto compartido; la API usa SHA-256 y canonical string.                                                                                               |
| Nonce               | Valor de un solo uso para evitar replay durante ventana de timestamp.                                                                                                         |
| Idempotency-Key     | Cadena opaca no vacía que identifica operación repetida, scoped por tenant/tipo/recurso; se acompaña de hash del body. UUID es una recomendación de cliente, no un requisito. |
| externalReference   | Identificador de negocio aportado por integrador para reconciliar request.                                                                                                    |
| RLS                 | Row Level Security de PostgreSQL; restringe acceso por app.tenant_id y permite scope worker.                                                                                  |
| CLS                 | Context-local storage usado para pasar tenantId, credentialId y correlationId.                                                                                                |
| resourceKey         | Identidad de recurso dentro de scope de idempotencia; en notas representa documento original.                                                                                 |
| GROSS               | Modo de precio con IVA incluido; motor descompone base neta.                                                                                                                  |
| NET                 | Modo con precio neto y cálculo/adición de IVA.                                                                                                                                |
| XMLDSig             | Firma digital XML implementada por xml-crypto y material X.509/PFX.                                                                                                           |
| RUT                 | Identificador tributario chileno; DTO de receptor aplica verificación de dígito.                                                                                              |
| observed / REPARO   | Estado público/interno cuando SII devuelve una observación/reparo.                                                                                                            |
| integration_request | Registro durable que representa solicitud B2B y estado visible al cliente.                                                                                                    |
| Worker scope        | Setting app.worker_scope=true que permite procesamiento cross-tenant dentro de transacción de job.                                                                            |
| Perfil visual       | Versión inmutable de logo/colores usada al regenerar PDF del DTE.                                                                                                             |
