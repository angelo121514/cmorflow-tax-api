# Contribuir a CmorFlow Tax API

El objetivo es que cada cambio se pueda entender, revisar y reproducir. Empieza por el [README](README.md), la [documentación](docs/README.md) y el [índice de features](docs/spec/SPEC_INDEX.md).

## Preparar el entorno

Usa Node 22 (22.12 o posterior dentro de la rama 22) y PostgreSQL 16. El archivo .nvmrc declara la rama de Node. Instala con npm ci para respetar package-lock.json. Copia .env.example a .env, genera secretos locales propios y usa SII_INTEGRATION_MODE=mock. Nunca adjuntes PFX, CAF privados, contraseñas ni datos tributarios reales a issues o PRs.

Para Docker Compose usa .env.local; el conjunto inyecta las variables en API, migración y worker. Consulta el README para iniciar cada alternativa.

## Cambiar una funcionalidad con SDD

1. Localiza el ID F-xx y revisa las reglas, API, persistencia y pruebas relacionadas.
2. Copia [CHANGE_TEMPLATE.md](docs/spec/CHANGE_TEMPLATE.md) a docs/spec/changes/NNNN-descripcion.md. Describe el problema, decisiones, criterios observables, riesgos y pruebas.
3. Completa el bloque sdd con rutas exactas desde la raíz. Incluye en code todos los archivos relevantes que modifica el PR; tests enumera pruebas reales. Las eliminaciones se declaran en removed. Para cambios sin impacto verificable que no necesitan pruebas, usa tests vacío y testExemption con un motivo concreto.
4. Implementa el cambio y actualiza las specs, [índice](docs/spec/SPEC_INDEX.md) y [matriz](docs/spec/TRACEABILITY.md) cuando corresponda. Los enlaces deben apuntar a archivos reales.
5. Ejecuta las comprobaciones y abre un PR con la plantilla. El revisor evalúa los criterios; CI verifica referencias, cobertura del diff y contrato.

CI exige una ficha nueva o actualizada para cambios en src/, test/, scripts/, workflows, dependencias, configuración de ejecución y baseline OpenAPI. Cambios exclusivamente editoriales en documentación no requieren ficha. El check no demuestra por sí mismo que un test cubra semánticamente el comportamiento: esa evaluación corresponde a la revisión.

## Comprobaciones

```bash
npm run build
npm run repo:check
npm run sdd:test
npm run sdd:check -- --base-ref origin/main --worktree
npm run openapi:check
npm test -- --runInBand
npm run test:e2e -- --runInBand
```

Obtén primero la referencia base con git fetch origin. Si trabajas sobre otro destino, sustituye origin/main. Para revisar sólo cambios locales respecto al último commit puedes usar --base-ref HEAD --worktree. Sin base, sdd:check valida documentos y referencias, pero no verifica el diff.

PostgreSQL e2e necesita POSTGRES_E2E_URL dirigido a una base desechable: sus fixtures crean roles/tablas y limpian datos. CI usa PostgreSQL 16. Cuando falta esa variable, las suites de DB se omiten; no informes que la persistencia quedó validada.

## Contrato, reglas tributarias y migraciones

Si cambias HTTP, actualiza el contrato, ejecuta npm run openapi:update y revisa el diff de ohbs-openapi.json antes de confirmar. No regeneres el baseline para ocultar una incompatibilidad involuntaria.

Registra migraciones con up/down y explica los riesgos de rollback. Las reglas tributarias bloqueadas en [DECISIONS.md](docs/spec/DECISIONS.md) requieren evidencia y aprobación antes de modificar el cálculo o afirmar certificación.

## Revisión y comunicación

Usa ramas cortas con nombres descriptivos y PRs centrados en un cambio. Explica qué problema resuelves, el comportamiento resultante y la validación realmente ejecutada. Registra limitaciones y resultados omitidos. Actualiza CHANGELOG.md para cambios visibles al integrador o al mantenedor.

Aplica el [código de conducta](CODE_OF_CONDUCT.md). Para vulnerabilidades utiliza el [procedimiento privado](SECURITY.md).
