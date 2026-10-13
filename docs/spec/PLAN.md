# Plan SDD

## Entrega MIT y alineación documental

1. Registrar comparación y baseline; conservar IDs F-xx, BR-xx y D-xxx.
2. Incorporar MIT para código original, preservar avisos y documentar condiciones desconocidas.
3. Adoptar constitución y amenazas; centralizar pendientes con criterios y responsables.
4. Exigir documentos, enlaces y tareas completas mediante el checker existente en CI.
5. Ejecutar checks y publicar PR; integrar sólo con backend aprobado. No cambia HTTP, esquema, tipos públicos ni reglas tributarias.

## Trabajo posterior

[TASKS](TASKS.md) fija criterios de aceptación. Orden: TASK-001 y TASK-002 antes de operación concurrente; TASK-003 antes de prometer entrega durable; TASK-004/005 antes de operación tributaria certificada; TASK-006 antes de afirmar permisos sobre todos los recursos distribuidos. Cada tarea necesita una ficha propia antes de modificar runtime.

## Definición de terminado

Spec y ficha preceden código; referencias reales y diff cubierto; pruebas focales y CI en Node 22/PostgreSQL 16; contrato revisado; resultados y omisiones en [VALIDATION_REPORT](VALIDATION_REPORT.md). Mantenedor revisa semántica y compatibilidad. Rollback documental revierte el commit; no borra atribuciones ni pretende revocar permisos ya concedidos en copias MIT. No se despliega esta entrega.
