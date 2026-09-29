# Aprovisionamiento de tenants

## Estado

El repositorio no contiene una ruta HTTP, comando de provisioning ni runbook aprobado para crear un tenant y completar su perfil tributario. La API presupone que el `tenant_id` ya existe y que una credencial válida está asociada a él. Por seguridad, este documento no inventa un procedimiento SQL ni afirma que `admin:bootstrap` aprovisione clientes.

## Secuencia de alta propuesta, pendiente de autorización operativa

El alta sigue este orden cuando Operaciones identifique y apruebe su sistema fuente y operador. Los pasos marcados como bloqueados requieren ese procedimiento autorizado; no se deben sustituir por SQL manual ni por una ruta no soportada.

1. **Identidad y alta base — bloqueado:** registrar el tenant/RUT en el sistema fuente aprobado y obtener su `tenant_id`.
2. **Perfil tributario — bloqueado:** completar razón social y configuración fiscal mediante el proceso soportado. `TenantConfigService.saveTaxProfile` es interno y no constituye una interfaz de provisioning.
3. **Acceso administrativo:** crear una credencial `admin` ligada al tenant desde el flujo autorizado de administración y entregar el secreto una sola vez por canal seguro.
4. **Configuración de emisión:** cargar CAF, certificado PFX y configuración de emisor; revisar alcance y permisos de la credencial.
5. **Verificación:** en el ambiente SII de certificación acordado, probar firma, emisión, consulta del TrackID y acceso a XML/PDF; guardar evidencia con fecha, versión y responsable.
6. **Habilitación productiva:** sólo después de que el propietario tributario apruebe la evidencia y Operaciones confirme el tenant, monitoreo y rotación de secretos.

## Bloqueo pendiente

Operaciones/Producto deben identificar el sistema fuente, el operador autorizado, la forma soportada de alta/actualización y el proceso de baja. `TenantConfigService.saveTaxProfile` existe, pero no hay controlador ni comando que lo exponga. Hasta aprobar ese runbook, el provisioning sigue siendo precondición externa y no se debe habilitar un tenant basándose sólo en una inserción manual.
