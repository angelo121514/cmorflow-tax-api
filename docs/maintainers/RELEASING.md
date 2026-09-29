# Preparar una versión y un repositorio colaborativo

## Confirmar el cambio

1. Revisa git status y el diff completo. El árbol puede contener trabajo previo; confirma sólo conjuntos revisados y coherentes.
2. Incluye archivos nuevos de specs, scripts, pruebas y migraciones. Una validación local no los incorpora automáticamente a Git.
3. Ejecuta repo:check, sdd:test, sdd:check contra la base del PR, build, OpenAPI y pruebas relevantes.
4. Revisa las fichas SDD y conserva el resultado real de cada comando, incluidos fallos u omisiones.
5. Abre el PR y espera el job backend con Node 22 y PostgreSQL 16, incluido el build Docker.

## Configurar GitHub

Estas opciones requieren configuración en el repositorio remoto:

- Protege main con PR y al menos una revisión cuando haya otro mantenedor disponible.
- Exige el check backend de CI antes de integrar.
- Restringe force push y eliminación de main; considera exigir resolución de conversaciones.
- Habilita reportes privados de vulnerabilidades en Security.
- Revisa permisos de colaboradores, secretos de Actions y entornos de despliegue.
- Revisa el historial para detectar secretos o datos privados antes de cambiar la visibilidad. repo:check detecta nombres de archivos privados versionados; no sustituye una revisión de contenido/historial.

## Configuración aplicada (2026-09-28)

En angelo121514/cmorflow-tax-api se habilitaron reportes privados de vulnerabilidades. main exige PR, check backend de GitHub Actions con base actualizada, resolución de conversaciones e historial lineal; también afecta al administrador. No permite force push ni eliminación. El mínimo de aprobaciones es cero mientras sólo exista el propietario como mantenedor; elevarlo a una al incorporar otro mantenedor capaz de revisar.

## Preparar la publicación

Actualiza CHANGELOG.md y el estado del README. Define versión y etiqueta sólo después de revisar el resultado de CI. Marca como experimental cualquier versión cuya certificación SII o reglas tributarias sigan pendientes.

Conserva una vía reproducible de instalación con Node 22, PostgreSQL 16 y modo SII mock. No distribuyas archivos de entorno reales, PFX ni CAF privados. El certificado público de confianza en certs/ no es una llave privada.

La decisión de licencia queda pendiente para una tarea posterior. La apertura pública y el despliegue requieren sus decisiones correspondientes; este procedimiento prepara la revisión.

## Aprobaciones externas

DECISIONS.md mantiene los bloqueos de T46 y provisioning. La certificación SII debe tener fecha, versión, ambiente y responsable. Un resultado de tests mock o un tag de Git no aprueba esos puntos.
