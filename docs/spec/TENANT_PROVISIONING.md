# Aprovisionamiento de tenants

## Instalación independiente: procedimiento soportado

Desde 2026-10-14 existe `npm run tenant:provision -- --standalone perfil.json`. Operaciones ejecuta con acceso autorizado a una base de propiedad exclusiva de Tax API y migraciones aplicadas. El sistema fuente de este modo es el archivo de alta aprobado por Producto/Operaciones, sin secretos. El comando no se utiliza sobre la base compartida del ERP.

```json
{
  "tenantId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "rut": "76086428-5",
  "businessName": "Empresa de prueba",
  "taxProfile": {
    "giro": "Servicios", "activities": ["620100"],
    "address": "Calle de prueba 1", "commune": "Santiago", "city": "Santiago",
    "resolutionDate": "2026-01-01", "resolutionNumber": 0
  }
}
```

1. Aplicar migraciones y respaldar según la instalación. Revisar RUT, UUID, razón social y resolución con el responsable tributario; el ejemplo es sintético.
2. Ejecutar el comando. Crea tenant, perfil y auditoría en una transacción; rechaza duplicados y campos inválidos, no actualiza identidades existentes ni habilita T46. Si falla, se revierte toda el alta.
3. Ejecutar `npm run admin:bootstrap -- UUID` y entregar el secreto mostrado una sola vez mediante el canal seguro del operador. Si este paso falla, el tenant permanece sin credencial: repetir bootstrap tras diagnosticar, sin repetir el alta.
4. Cargar PFX/CAF mediante la API administrativa, configurar recursos externos y verificar aislamiento y contratos en staging.
5. Completar el [gate SII](SII_CERTIFICATION_CHECKLIST.md) antes de habilitar emisión real. Registrar operador, aprobación y evidencia; una prueba local no acredita staging.

Recuperación: fallo de alta hace rollback. Después de crear una credencial o emitir, no borrar tenant/folios como rollback; revocar credenciales y bloquear emisión bajo el procedimiento operativo autorizado. El perfil puede corregirse por el mantenedor con una ficha y evidencia revisadas.

## Base compartida con ERP

El sistema fuente sigue siendo externo; D-007 permanece bloqueada para ese modo hasta identificar proceso y responsable del ERP. No se inventa una ruta HTTP ni se modifica el ERP. TASK-004 queda parcialmente resuelta: CLI y pruebas de base independiente disponibles, aprobación y ejecución staging aún externas.
