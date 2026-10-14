# Gate de certificación SII

Fecha: 2026-10-14. Responsable: Tributario/SII con Operaciones. La corrección técnica no acredita certificación.

1. Identificar versión/commit, RUT autorizado, ambiente de certificación y operador. Usar material tributario legítimo fuera del repositorio.
2. Obtener esquemas vigentes desde [SII](https://www.sii.cl/servicios_online/3532-formato_xml-3811.html); registrar URL, fecha y SHA-256 local. Configurar SII_XSD_DIR o paths individuales y mantener validación habilitada.
3. Cargar perfil, PFX y CAF del tenant; validar vigencia, RUT y disponibilidad. No usar certificados mock en una habilitación real.
4. Ejecutar el set oficial asignado: firma XML/TED, envío, TrackID, consulta, XML/PDF, RCOF y notas que correspondan. Guardar identificadores de evidencia sin incluir secretos ni datos privados en el repo.
5. D-006: obtener confirmación y fixture autorizado para T46/retenciones antes de cambiar su cálculo. No se habilita T46 con el nuevo comando de provisioning.
6. Registrar resultado formal SII, fecha, ambiente, versión y responsable; sólo entonces cerrar TASK-005 y habilitar emisión productiva con monitoreo.

## Conciliación de envíos ambiguos

Un DTE con transmission_started_at y sin TrackID recuperable pasa a failed con retryable:false. Una caída después de iniciar el envío no prueba si SII lo recibió. El operador consulta el estado de recepción en SII; si recupera TrackID, registra la evidencia y prepara una corrección de datos revisada que vincule ese TrackID al mismo DTE. No borrar marcadores ni emitir con otra key/folio para intentar resolver la ambigüedad. Si SII confirma que no hubo recepción, un procedimiento de reintento explícito requiere esa evidencia y revisión operativa; no existe liberación automática.

Se mantiene el mismo folio y documento. Esto ofrece recuperación local atómica y evita reenvíos ciegos; no promete exactly-once sobre un servicio externo sin protocolo de idempotencia documentado.
