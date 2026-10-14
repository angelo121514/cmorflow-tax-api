# Esquemas externos del operador

Sólo se conserva `xmldsignature_v10.xsd` con su cabecera W3C original. Los demás esquemas ya no se redistribuyen sin permiso documentado.

Obtén los esquemas necesarios desde [Formato XML oficial SII](https://www.sii.cl/servicios_online/3532-formato_xml-3811.html), conserva el paquete completo con sus imports/includes y registra URL/fecha/hash. Para un esquema CAF no provisto por el SII, usa sólo una fuente cuyo uso tengas autorizado; no se sustituye por un esquema parcial.

Monta el directorio en API y worker y configura SII_XSD_DIR=/opt/cmorflow/sii-xsd. Se conservan los overrides SII_ENVIO_DTE_XSD_PATH, SII_ENVIO_BOLETA_XSD_PATH, SII_CONSUMO_FOLIO_XSD_PATH, SII_CAF_XSD_PATH y SII_LIBRO_CV_XSD_PATH. No cambies SII_XSD_VALIDATION_ENABLED a false para sortear un esquema ausente. xmllint falla si falta el esquema o alguno de sus imports.

Ejemplo Docker: `--mount type=bind,src=/ruta/autorizada/xsd,dst=/opt/cmorflow/sii-xsd,readonly --env SII_XSD_DIR=/opt/cmorflow/sii-xsd`. El modo mock local no requiere material real; certificación y producción sí requieren esquemas válidos.
