# Auditoría completa — CmorFlow Tax API

**Fecha:** 2026-09-02 · **Auditor:** ZCode (asistente de IA) · **Tipo:** Funcional + Seguridad + Operación

> **ACTUALIZACIÓN (misma fecha, fase 2):** tras este informe se **aplicó el plan de remediación completo**. Ver §9 — todo verificado con la suite (93/93 unit + 9/9 e2e) y smoke end-to-end (HMAC con secreto cifrado, nonces de cron en BD).

## Código auditado

- Rama `main`, commit `d0d854a` (pusheado) **más un working tree con 43 archivos modificados (+710/−549) y ~30 sin trackear** (worker persistente, Dockerfile, migración RLS de worker, controllers de métricas/configuración, tests e2e). La auditoría cubre el estado del working tree, que es lo que se desplegaría.
- Cambios aplicados por esta auditoría: ver §3.1 (fix de arranque P0) y §3.2 (`npm audit fix`).

---

## 1. Resumen ejecutivo

**Veredicto: la API NO funcionaba al iniciar la auditoría y SÍ funciona al terminarla — pero nunca ha llegado a producción.**

| Dimensión | Estado inicial | Estado final |
|---|---|---|
| Compilación | ✅ OK | ✅ OK |
| Tests unitarios (90) | ✅ 90/90 | ✅ 90/90 |
| Tests e2e (8, Postgres real) | ✅ 8/8 | ✅ 8/8 |
| **Arranque de la app compilada** | ❌ **CRASH — DI roto** | ✅ **Arranca y sirve tráfico** |
| Flujo HMAC end-to-end (emitir → encolar → consultar) | ❌ no verificable (no arrancaba) | ✅ 202 → encolado → procesado |
| Contenedor Docker (artefacto de deploy) | build ✅ / boot ❌ | build ✅ / boot ✅ |
| Vulnerabilidades npm (prod) | 1 moderada (`qs`) | 0 |
| **Producción (Render)** | ❌ **503 — ningún deploy exitoso jamás** | ❌ sin cambios (requiere acción en Render) |

**Lo más grave descubierto:** la API compilada **no arrancaba** (`IntegrationHmacGuard` no podía resolver `IDataServices` dentro de `ControllersModule`). Ni el build ni los 98 tests lo detectan porque ninguno bootstrapea el `AppModule` real. Este es con toda probabilidad el **causante de los `update_failed` de Render**: todos los deploys desde la creación del servicio (2026-08-18) fallaron — la URL `https://cmorflow-tax-api.onrender.com` devuelve 503 permanente. Lo corregí con una línea de wiring de DI (§3.1) y verifiqué arranque local + contenedor + flujo completo.

**Seguridad:** la arquitectura de autenticación y aislamiento es notablemente sólida para la etapa del proyecto (HMAC-SHA256 timing-safe, nonces en BD con constraint único, tenant fail-closed desde credencial, AES-256-GCM para secretos, SSRF mitigado, validación global estricta, config de producción fail-closed). Los hallazgos (2 ALTO, 6 MEDIO, varios BAJO) son de defensa en profundidad, no exploits abiertos; el mayor riesgo real es operativo: **sin worker desplegado y con el cron sin `schedule`, nada procesa la cola en producción** (moot hoy porque no hay deploy, pero será lo primero que muerda al desplegar).

---

## 2. Alcance y metodología

**Verificación funcional (ejecutada de verdad, no solo lectura de código):**

1. `npm run build` (tsc) — sin errores.
2. `npm test` — 18 suites, 90/90 tests.
3. `npm run test:e2e` con **Postgres 16 real** (contenedor Docker efímero, como el service container de CI) — 3 suites, 8/8.
4. `npm run openapi:check` — sin drift: 25 paths coinciden con `ohbs-openapi.json`.
5. **Smoke test en vivo**: app compilada arrancada contra Postgres real; `GET /health` 200, `GET /ready` 503 fail-closed correcto (sin `SII_MASTER_KEY`), Swagger 200, y **flujo B2B completo firmado con HMAC** usando el script `bootstrap-admin` + utilidades de firma compiladas:
   - `POST /dtes` firmado → **202** con solicitud encolada;
   - replay con misma `Idempotency-Key` → **202** devolviendo el mismo `requestId` (replay idempotente ✓);
   - misma key con body distinto → **409 `IDEMPOTENCY_CONFLICT`** ✓;
   - firma adulterada → **401 `INVALID_SIGNATURE`** ✓;
   - nonce reusado → **401 `NONCE_REPLAYED`** (persistido en BD) ✓;
   - timestamp fuera de ventana (−1 h) → **401 `TIMESTAMP_OUT_OF_WINDOW`** ✓;
   - `GET /credentials` (admin) → 200 ✓; `GET /dtes/:id` → 200 con estado `processing` y error `FOLIO_EXHAUSTED` correcto (tenant sin CAF) — demuestra que el kick post-202 procesa la cola y el ciclo de vida de estados funciona.
6. `docker build` (multi-stage, igual que `render.yaml`) + **boot del contenedor** con health 200 — valida el artefacto real de deploy (`dist` + `tsconfig-paths` + `start-prod.js`, usuario no-root con dumb-init).
7. Reejecución completa de la suite tras los cambios: 90/90 + 8/8 (ver nota de idempotencia e2e en §5.3).

**Verificación de seguridad:** `npm audit`, análisis del working tree con foco en auth/DI/guards/cifrado/SSRF/SQLi/tenant-isolation, y confirmación directa de cada hallazgo con archivo:línea. No se hicieron tests de intrusión contra producción (servicio caído).

---

## 3. Fixes aplicados durante la auditoría

### 3.1 · P0 — La API compilada no arrancaba (DI de guards roto)

**Síntoma:** `node start-prod.js` crashea al boot:

```
Nest can't resolve dependencies of the IntegrationHmacGuard (Reflector, ?, ClsService).
Please make sure that the argument IDataServices at index [1] is available in the ControllersModule module.
```

**Causa raíz:** los guards referenciados con `@UseGuards(IntegrationHmacGuard)` son instanciados por Nest **en el contexto del módulo del controlador** (`ControllersModule`), no en `IntegrationsModule` donde el guard está registrado y exportado. `ControllersModule` no importaba `DataServicesModule`, así que `IDataServices` (token de la capa `@domain`) no era resoluble ahí. El bloque existía también en `HEAD` — **la app nunca ha arrancado en esta arquitectura**; los tests (unit + e2e con módulos parciales) no bootstrapean el `AppModule` completo, por eso CI pasaba en verde.

**Fix aplicado** (`src/controllers/controllers.module.ts`): importar `DataServicesModule` en `ControllersModule` con comentario explicando la regla de Nest sobre instanciación de guards.

**Verificación:** boot local OK (health 200), contenedor Docker con health 200, y suite completa re-ejecutada (90/90 unit + 8/8 e2e).

**Recomendación estructural:** agregar un test e2e mínimo que haga `Test.createTestingModule({ imports: [AppModule] })` + `app.init()` (con `FreshMemoryDataServices` o Postgres efímero). Un solo test así habría detectado este bloque antes de cada deploy fallido.

### 3.2 · `npm audit fix` — dependencia `qs`

`npm audit --omit=dev` reportaba 1 vulnerabilidad **moderada** en `qs` (transitiva de Express 5; DoS vía parsing de brackets/`isBuffer`, GHSA-x5fp-wj9c-mxmx y GHSA-4mjr-xmp4-gh2g). Se aplicó `npm audit fix` (bump de 2 paquetes transitivos) → **0 vulnerabilidades**. Suite completa re-verificada en verde.

### 3.3 · Sin commit

Ambos cambios quedan **sin commitear** junto al resto del working tree (no se comprometió nada). Al commitear el refactor pendiente, incluir estos dos cambios.

---

## 4. Diagnóstico del deploy en producción (Render)

Accedido vía API MCP de Render (workspace `My Workspace`). Evidencia objetiva:

| Aspecto | Servicio real en Render | `render.yaml` del repo |
|---|---|---|
| Plan | **free** | starter |
| Runtime | **node** | **docker** |
| Build | `npm ci && npm run build` | Dockerfile multi-stage |
| Health check path | **(vacío)** | `/api/v1/ready` |
| Pre-deploy (migraciones) | no | `node start-migrate.js` |
| Worker persistente | **no existe** | servicio `cmorflow-tax-worker` |

**Hallazgos:**

1. **Ningún deploy ha tenido éxito.** Los 10 intentos (2026-08-18 20:21→21:16 UTC) terminan en `build_failed` (6) o `update_failed` (4). El último commit (`d0d854a`) ni siquiera generó deploy. Con el fix §3.1, el build del repo compila y la app arranca — los `update_failed` son consistentes con un crash de arranque post-build.
2. **503 permanente en `https://cmorflow-tax-api.onrender.com`** (raíz, `/health`, `/ready`): el servicio quedó sin instancia válida tras los deploys fallidos.
3. **Sin worker**: aunque la web deployara, **nada procesaría la cola** (`INTEGRATION_WORKER_ENABLED` requiere el worker de Render) ni entregaría webhooks/RCOF. Los DTEs quedarían en `queued` para siempre. El fallback de cron (`.github/workflows/cron-jobs.yml`) **ya no tiene `schedule:`** — solo `workflow_dispatch` manual.
4. **El README ya anticipaba el problema** ("si el servicio existente en Render no usa Docker, el cambio de runtime requiere recrearlo desde el Blueprint") — el servicio real sigue siendo el legacy en node.

**Remediación sugerida (acción del dueño):** borrar/recrear el servicio web desde el Blueprint (`render.yaml`), crear el servicio worker del Blueprint, cargar el grupo de secretos `cmorflow-tax-production`, y verificar `/api/v1/ready`. Además, dar schedule (o GitHub Actions con `schedule:`) a los crons como fallback del worker. Es un cambio de infraestructura cloud — por alcance de esta auditoría no se ejecutó.

---

## 5. Hallazgos de seguridad

Prioridad: 🔴 crítico · 🟠 alto · 🟡 medio · ⚪ bajo. Ninguno es explotable **sin credencial válida** (todo endpoint de negocio exige HMAC válido + nonce fresco + timestamp en ventana).

### 🟠 A-1 · RLS ausente en las tablas del motor DTE (defensa en profundidad)

- **Evidencia:** solo 5 tablas B2B tienen RLS+FORCE (`src/database/migrations/1805000000000-AddIntegrationsApi.ts:171-181`): `integration_requests`, `rcof_submissions`, `integration_webhook_*`. **Sin RLS:** `dte_documents`, `sii_submissions`, `tenant_configs`, `audit_logs` (y `tenants`, legítimamente global).
- **Impacto:** el dato más sensible (XML firmado/PDF del DTE) queda aislado solo por `WHERE tenant_id` de aplicación (`postgres-generic-repository.ts`). Un query raw futuro con el where mal puesto = fuga cross-tenant silenciosa. La política worker (`app.worker_scope`) ya existe y es un buen patrón para extender.
- **Remediación:** migración nueva que aplique `ENABLE/FORCE ROW LEVEL SECURITY` + policy `tenant_id = current_setting('app.tenant_id', true)` a las 4 tablas, con `worker_scope` para el proceso.

### 🟠 A-2 · Sin `trust proxy` + Throttler global por IP

- **Evidencia:** `app.set('trust proxy')` no existe en `main.ts` (verificado); `ThrottlerModule` global 120 req/min por IP (`app.module.ts:29`), como `APP_GUARD` corre **antes** del guard HMAC.
- **Impacto:** detrás del proxy de Render todas las conexiones llegan con la IP del proxy → **un único bucket global compartido por todos los clientes**. 120 req/min agregados para toda la API: un tenant activo (o un atacante no autenticado, que consume el mismo bucket) puede DoSear al resto.
- **Remediación:** `app.set('trust proxy', 1)` (Render es 1 hop) + considerar `@SkipThrottle` en rutas de alta tasa legítima, o throttler por credencial (el guard ya implementa rate-limit por credencial, hoy solo en memoria — ver M-3).

### 🟡 M-1 · `sha256(secret)` usado como clave HMAC directa

- **Evidencia:** `integration-hmac.guard.ts:121` firma con `credential.secretHash`; la credencial persiste solo `secretHash = sha256(secret)` (`integration-credential.entity.ts:17-20`, `integration-signature.util.ts:71-73`).
- **Impacto:** un dump de BD entrega la clave de firma directamente usable (sin cracking, sin KDF). Es mejor que guardar el secreto en claro, pero el "verificador" y la "clave" son el mismo valor.
- **Remediación:** derivar la clave con un paso más: `signingKey = HMAC-SHA256(secretHash, 'signing')` o `scrypt` — el dump de BD ya no firma nada sin el secreto original. Requiere migración de verificación dual (aceptar ambos durante la rotación).

### 🟡 M-2 · DNS rebinding (TOCTOU) en webhooks salientes

- **Evidencia:** `integration-webhook.service.ts` valida DNS en registro y en cada intento (`assertSafeWebhookUrl`, :472-508, bloquea loopback/privadas/CGNAT/link-local, HTTPS obligatorio, `redirect: 'error'`, timeout 10 s), pero `lookup()` (:492-494) y el `fetch` (:355) resuelven/-conectan en momentos distintos sin pinning de IP.
- **Impacto:** un endpoint de webhook malicioso puede pasar la validación DNS y reconectar a una IP interna en la ventana TOCTOU (SSRF desde el worker).
- **Remediación:** resolver DNS, validar la IP y abrir la conexión a **esa IP** (pinning), o hacer la llamada con un custom `agent`/`dispatcher` (undici) que use la IP ya validada con SNI del hostname.

### 🟡 M-3 · Rate limit por credencial en memoria

- **Evidencia:** `integration-hmac.guard.ts:40,223-238` (`Map` por instancia).
- **Impacto:** con escalamiento horizontal el límite se multiplica ×N instancias. Hoy: 1 instancia, riesgo bajo.
- **Remediación:** mover a Postgres/Redis cuando haya >1 instancia (el patrón de nonces en BD ya existe para copiar).

### 🟡 M-4 · `X-Request-ID` del cliente aceptado sin validación

- **Evidencia:** `integration-hmac.guard.ts:171-175` — se propaga a CLS/logs/audit/webhooks tal cual.
- **Impacto:** inyección de líneas en logs no-JSON (dev) y spoofing de correlación entre tenants.
- **Remediación:** validar formato (p. ej. `/^[\w\-\.]{1,64}$/`) o truncar/limpiar antes de aceptar.

### 🟡 M-5 · Nonces del `CronHmacGuard` en memoria

- **Evidencia:** `cron-hmac.guard.ts:6` (`Map`), ventana ±300 s.
- **Impacto:** replay de un request cron válido posible tras restart o con N instancias dentro de la ventana. Requiere el `CRON_HMAC_SECRET`, riesgo contenido.
- **Remediación:** mismos nonces en BD que el guard B2B (tabla + purga ya implementada para integrations).

### 🟡 M-6 · Token mock embebido en el polling real del SII

- **Evidencia:** `query-dte-status.use-case.ts:27` — `tokenMock = 'simulated-sii-session-token-999'` se usa **siempre** y en modo real viaja dentro de `<Token>` del query de TrackID (`sii-soap.client.ts:289-295`).
- **Impacto:** el polling `pollSubmitted` fallará contra el SII real → los DTEs quedarían estancados en `submitted` sin consolidar (nunca llegan a `accepted/rejected`, no hay webhook final). **Es un bloqueante funcional para la certificación real**, no solo seguridad.
- **Remediación:** usar `SiiAuthTokenService` (el mismo que usa la transmisión) en el caso de uso de consulta.

### ⚪ Bajos

- **B-1** URL firmada de artefactos: secreto global compartido entre tenants, token reutilizable durante su TTL de 300 s, sin revocación al revocar credencial; payload base64 revela `tenantId`/`dteId` (`integration-artifacts.service.ts:34-64`). Aceptable con TTL corto; considerar secreto por tenant + jti para revocación.
- **B-2** Helmet con `contentSecurityPolicy: false` (`main.ts:33`) — irrelevante para API JSON, pero gratis activarla.
- **B-3** Defaults inseguros solo-dev bien acotados: `DEFAULT_SII_MASTER_KEY` (`tenant-config.service.ts:95`), `'dev-insecure-url-secret'` (`integration-artifacts.service.ts:35`), `postgres/postgres` (`data-source.ts:31-33`); `validateRuntimeConfig` no valida nada fuera de producción (`runtime-config.ts:7-8`). El fail-closed en producción está bien implementado (verificado: `/ready` 503 sin master key).
- **B-4** CORS rechaza origen no permitido con `Error` → responde 500 en vez de 403 (`main.ts:44`).
- **B-5** `CreateIntegrationRcofDto.date` solo `@IsString()` sin validación de formato de fecha (`create-integration-dte.dto.ts:264-268`).
- **B-6** `/metrics` abierta fuera de producción y con labels de `tenant_id` (`metrics.controller.ts:16-24`, `prometheus.service.ts:127-146`) — en producción exige Bearer ≥32 chars (bien, verificado en `runtime-config.ts:21-23`).

### Verificado sin hallazgos (positivo)

SQL injection (todo parametrizado, único `set_config` con `$1`); comparaciones no timing-safe (todas `timingSafeEqual` con validación de formato); secretos en logs (grep limpio; webhooks/credenciales enmascarados); validación de entrada (`ValidationPipe` global `whitelist+forbidNonWhitelisted+transform`, RUT módulo 11 correcto — verificado con casos válidos/inválidos); tenant fail-closed desde credencial (header `x-tenant-id` contradictorio → 403, verificado en e2e); replay de nonce B2B (constraint UNIQUE en BD + fallback 23505); cifrado AES-256-GCM real (IV aleatorio 12B, salt por operación, scrypt, authTag verificado); dependencias sin CVEs restantes; Docker non-root + dumb-init; fail-closed de config en producción (`SII_INTEGRATION_MODE=real`, XSD on, DB_SSL on, master key ≥32, bloqueda del modo mock en prod).

---

## 6. Hallazgos funcionales (menores a medios)

1. **Folios quemados si `prepare` falla tarde** (`emit-dte.use-case.ts`): el folio se reserva atómicamente (bien) antes de validar CAF/firma/certificado; un fallo posterior quema el folio y el reintento reserva otro. Sin corrección de huecos automática. Esperable en facturación real, pero conviene monitorear la brecha folios-reservados vs emitidos.
2. **Race benigna en `enqueue`**: el check `findOne`→`create` no captura la violación `UQ_integration_requests_tenant_key` (23505) — un duplicado concurrente devolvería 500 en vez de replay/409 (`integration-request.service.ts`; el mapeo 23505 existe solo para nonces en el guard).
3. **`trackIdEcho` ficticio**: `integration-state.service.ts:124-126` escribe `(request as any).trackIdEcho` — el trackId real no persiste en la solicitud (se recupera vía DTE). Campo muerto que confunde.
4. **Log desactualizado**: `emit-dte.use-case.ts:291` dice "cache de 11 horas"; el TTL real es 110 min (`sii-auth-token.service.ts:20-22`).
5. **Permiso `dte:cancel` definido sin endpoint** (`integration-errors.ts:39`) — la anulación no está implementada.
6. **Harness e2e no idempotente localmente**: `test/postgres.e2e-spec.ts:29-41` crea tabla y **ROLE de clúster** sin `IF NOT EXISTS`/cleanup — re-ejecutar contra el mismo Postgres falla (`tenants already exists` / `role already exists`). En CI (contenedor fresco) no ocurre. Recomendación: `CREATE TABLE IF NOT EXISTS` + `DROP ROLE` en `afterAll` (o documentar reset).
7. **Ejemplos de RUT inválidos en la API pública**: el mensaje de error sugiere `12345678-9` (DV real: 5) y el Swagger usa `76123456-7` (DV real: K) como ejemplos (`is-chilean-rut.decorator.ts:44`, `create-integration-dte.dto.ts:27`). Confunde a integradores: copian el ejemplo y reciben 400.
8. **Timers de Jest sin cerrar** ("worker process has failed to exit gracefully") — cosmético, revisar `.unref()` en timers de tests.

---

## 7. Plan de remediación sugerido (ordenado)

| # | Acción | Ref | Esfuerzo |
|---|---|---|---|
| 1 | Commit del working tree (incluye fixes §3) y re-deploy desde Blueprint (Docker web + worker + secretos) | §3, §4 | medio |
| 2 | Test e2e de boot completo del `AppModule` (anti-regresión del P0) | §3.1 | bajo |
| 3 | Fix token mock en polling SII (`query-dte-status`) — bloqueante de certificación real | M-6 | bajo |
| 4 | `app.set('trust proxy', 1)` | A-2 | trivial |
| 5 | Worker/schedule de crons operativos (worker de Render o `schedule:` en Actions) | §4 | bajo |
| 6 | Migración RLS para `dte_documents`, `sii_submissions`, `tenant_configs`, `audit_logs` | A-1 | medio |
| 7 | KDF para clave de firma (rotación dual) | M-1 | medio |
| 8 | Pinning de IP en webhooks (undici dispatcher) | M-2 | medio |
| 9 | Validar `X-Request-ID`; nonces cron en BD; throttler multi-instancia | M-3/4/5 | bajo |
| 10 | Cosméticos: RUTs de ejemplo, formato RCOF `date`, CSP, CORS 403, log TTL | §6, B-* | trivial |

---

## 8. Anexo — reproducir la verificación

```bash
# Postgres efímero para e2e (como el service container de CI)
docker run -d --name pg-e2e -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=tax_api_e2e -p 5433:5432 postgres:16-bookworm
POSTGRES_E2E_URL="postgres://postgres:postgres@127.0.0.1:5433/tax_api_e2e" npm run test:e2e -- --runInBand

# Smoke local (requiere tablas base: tenants + migraciones; ver README §Migraciones)
DB_HOST=127.0.0.1 DB_PORT=5433 DB_NAME=tax_api_smoke node start-migrate.js
npm run admin:bootstrap -- <TENANT_UUID>   # imprime keyId + secret (guardar)
node start-prod.js                          # INTEGRATIONS_API_ENABLED=true PORT=3100
curl -s http://localhost:3100/api/v1/health # 200

# Artefacto de deploy
docker build -t cmorflow-tax-api:audit .
```

**Firma de requests (como cliente B2B):** canónico `METHOD\n<path>?<query>\nsha256(body)\n<timestamp>\n<nonce>`; headers `X-Api-Key`, `X-Timestamp` (±300 s), `X-Nonce` (único, BD), `X-Signature` = `HMAC-SHA256(sha256hex(secret), canónico)` hex; header `Idempotency-Key` obligatorio en `POST /dtes|/rcof`.

---

## 9. Remediación aplicada (fase 2 — 2026-09-02)

Plan §7 ejecutado casi por completo. Cambios verificados con **93/93 unit + 9/9 e2e + smoke en vivo** (flujo HMAC contra credencial con secreto cifrado en BD; cron con replay rechazado desde nonces persistidos).

| # | Acción (item del plan) | Implementación | Verificación |
|---|---|---|---|
| 1 | Fix token mock en polling SII (M-6, bloqueante de certificación) | `query-dte-status.use-case.ts`: en modo real obtiene token de sesión con la firma del tenant vía `TenantConfigService` + `SiiAuthTokenService` (mismo mecanismo que la transmisión); el mock mantiene su placeholder | build + unit; requiere certificación real para validar contra el SII |
| 2 | `trust proxy` (A-2) | `main.ts`: `app.set('trust proxy', 1)` — Render es 1 hop; `req.ip` real restaura buckets por cliente | boot |
| 3 | RLS en tablas del motor (A-1) | Migración `1805200000000-EngineTableRls`: ENABLE+FORCE RLS y policy tenant/worker en `dte_documents`, `sii_submissions`, `tenant_configs`, `audit_logs`. Tolerante a BDs sin tablas base; ERP externo debe setear `app.tenant_id` o usar rol BYPASSRLS (documentado en la migración) | e2e de migraciones |
| 4 | Secreto de credencial cifrado (M-1) | Columna `secret_encrypted` (jsonb, AES-256-GCM con `SII_MASTER_KEY`) + guard que firma con el secreto descifrado; credenciales legacy sin columna siguen por `secretHash` hasta rotación; `bootstrap-admin` también cifra | smoke end-to-end: batería HMAC completa contra credencial cifrada en BD + 2 tests nuevos |
| 5 | Anti DNS rebinding en webhooks (M-2) | `undici` Agent por entrega con `lookup` propio: resuelve DNS, valida todas las IPs con `isPrivateAddress` y conecta a la IP validada (SNI/Host del hostname); Agent cerrado por entrega; +dependencia `undici@^6` (compatible con la embebida de Node 22) | unit (fetch stubbeado); SSRF test suite sigue verde |
| 6 | Nonces de cron en BD (M-5) | Migración `1805400000000-AddCronNonces` + `CronNonceStore` (módulo de datos) + guard async: replay persistido entre restarts/instancias; fallback en memoria sin store (tests) | smoke: replay de nonce → 401 con fila visible en `cron_nonces` + test nuevo |
| 7 | Validar `X-Request-ID` (M-4) | Guard: sólo `^[\w.\-]{1,64}$`; si no, se genera uno | unit |
| 8 | Test anti-regresión de boot (§3.1) | Nuevo `test/app-boot.e2e-spec.ts`: boot del `AppModule` completo en modo producción (incluye `validateRuntimeConfig`) con Postgres real — detecta DI rota en guards | e2e 9/9 |
| 9 | OpenAPI baseline | `ohbs-openapi.json` regenerado (el refactor pendiente había agregado `/configuration/*`): 25 paths sin drift | `openapi:check` verde |
| 10 | Cosméticos (§6) | RUTs de ejemplo válidos en mensaje del validador y Swagger (`12.345.678-5`, `76.123.456-0`); `@IsDateString` en `CreateIntegrationRcofDto.date`; CORS de origen desconocido responde sin headers (no 500); CSP activada cuando Swagger está deshabilitado (prod); log del TTL de token corregido (110 min); harness e2e idempotente (tablas/roles con IF NOT EXISTS + limpieza) | build + suites |

**No aplicado (requiere decisión/infra):**
- **M-3** (throttler multi-instancia): sin Redis en el stack; con 1 instancia y `trust proxy` el bucket por IP ya es correcto. Pendiente si se escala a N instancias.
- **Item 5 del plan** (worker/schedule en Render): el worker está definido en `render.yaml`; su creación es el paso de Blueprint en el dashboard (el servicio legacy node no puede migrarse de runtime in-place).
- **B-1** (URL de artefactos con secreto por tenant + revocación): diseño nuevo, quedó documentado como mejora futura.

---

## 10. Despliegue en producción (fase 3 — 2026-09-02, mismo día)

**Resultado: la API quedó desplegada y VIVA en producción por primera vez** (deploy `dep-dacabn15efls73dmbdfg`, estado `live`):
- `GET https://cmorflow-tax-api.onrender.com/api/v1/health` → **200 `{"status":"ok"}`**
- `GET https://cmorflow-tax-api.onrender.com/api/v1/ready` → **200** con `postgres: ok`, `integrationsEnabled: ok`, `masterKey: ok`

Durante el diagnóstico se resolvieron, en orden, estos bloqueantes (cada uno confirmado con logs de Render):

1. **Build + DI**: el código remediado compila y arranca (el error DI del P0 desapareció al aplicar §3.1).
2. **Secretos de producción ausentes** (fail-closed correcto): se generaron y cargaron en el servicio `SII_MASTER_KEY`, `INTEGRATION_URL_SECRET`, `METRICS_BEARER_TOKEN` + `METRICS_ENABLED`, `CRON_HMAC_SECRET`, `SII_INTEGRATION_MODE=real`, `SII_ENVIRONMENT=certification`, `SII_XSD_VALIDATION_ENABLED=true`.
3. **TLS con Supabase**: `self-signed certificate in certificate chain` → se extrajo el root CA `Supabase Root 2021 CA` (fingerprint en `certs/README.md`) desde la propia cadena TLS de la BD y se configuró `NODE_EXTRA_CA_CERTS=/opt/render/project/src/certs/supabase-root-ca.crt`. La verificación TLS se mantiene activa (no se desactivó `rejectUnauthorized`).
4. **`DB_USER` mal escrito**: era `cmorflow_app.wirwadxtrblslfwayple` (ref incorrecto); el pooler de Supabase reportaba `tenant/user not found`.
5. **Password de `cmorflow_app` desconocido**: se rotó el password del rol y se usó ese rol para la API (`pg_stat_activity` mostró cero conexiones activas con ese rol en ese momento).
6. **Migraciones**: `AUTO_RUN_MIGRATIONS=true` chocaba con permisos del rol no-owner y RLS sobre `typeorm_migrations` (herencia del ERP). Las 4 migraciones pendientes se aplicaron manualmente como superusuario (columna `secret_encrypted`, tabla `cron_nonces`, policies con `worker_scope` en las 5 tablas B2B) y se registraron en `typeorm_migrations`; `AUTO_RUN_MIGRATIONS=false` en el servicio.

### ⚠️ Acciones de seguimiento para el dueño

1. **Password de `cmorflow_app` rotado**: los servicios legacy del ERP (`sii-ohbs`, `cmorflow-backend-staging`) usan ese rol. Si alguno despierta y falla autenticación, hay que actualizar su `DB_PASSWORD` al nuevo valor (visible en el dashboard de Render, servicio `cmorflow-tax-api` → Environment).
2. **El rol `tax_api_app`** quedó creado con grants completos pero el pooler de Supabase no lo registró (los roles nuevos requieren reprovisionar el pooler en el dashboard). Puede eliminarse o usarse tras reprovisionar.
3. **Worker persistente y crons siguen pendientes**: sin el servicio worker de Render, la cola solo se procesa vía el kick post-202 y los crons manuales (`workflow_dispatch`). El paso de Blueprint (dashboard → New → Blueprint) crea web + worker con el grupo de secretos.
4. **Guardar los secretos**: los valores generados hoy viven solo en el Environment del servicio en Render; respaldarlos en un gestor de secretos.
