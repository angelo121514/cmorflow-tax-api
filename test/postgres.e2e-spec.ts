import { DataSource } from 'typeorm';
import { AddIntegrationsApi1805000000000 } from '../src/database/migrations/1805000000000-AddIntegrationsApi';
import { WorkerRlsPolicy1805100000000 } from '../src/database/migrations/1805100000000-WorkerRlsPolicy';
import { EngineTableRls1805200000000 } from '../src/database/migrations/1805200000000-EngineTableRls';
import { AddCredentialSecretEncrypted1805300000000 } from '../src/database/migrations/1805300000000-AddCredentialSecretEncrypted';
import { AddCronNonces1805400000000 } from '../src/database/migrations/1805400000000-AddCronNonces';
import { IntegrationRequestResourceKey1805600000000 } from '../src/database/migrations/1805600000000-IntegrationRequestResourceKey';
import { AllowSystemIntegrationRequests1805800000000 } from '../src/database/migrations/1805800000000-AllowSystemIntegrationRequests';
import { IntegrationQueueClaimer } from '../src/application/integrations/integration-queue.claimer';
import { IntegrationWebhookService } from '../src/application/integrations/integration-webhook.service';

const adminUrl = process.env.POSTGRES_E2E_URL;
const describePostgres = adminUrl ? describe : describe.skip;

describePostgres('PostgreSQL migrations, RLS, idempotency and queue claims', () => {
  let admin: DataSource;
  let app: DataSource;

  const tenantA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const tenantB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const credentialA = 'aaaaaaaa-0000-4000-8000-000000000001';
  const credentialB = 'bbbbbbbb-0000-4000-8000-000000000001';

  beforeAll(async () => {
    admin = new DataSource({
      type: 'postgres',
      url: adminUrl,
      entities: [],
      migrations: [
        AddIntegrationsApi1805000000000,
        WorkerRlsPolicy1805100000000,
        EngineTableRls1805200000000,
        AddCredentialSecretEncrypted1805300000000,
        AddCronNonces1805400000000,
        IntegrationRequestResourceKey1805600000000,
        AllowSystemIntegrationRequests1805800000000,
      ],
      migrationsTableName: 'typeorm_migrations',
    });
    await admin.initialize();
    await admin.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
    // Idempotente localmente: re-ejecutar contra el mismo Postgres no debe
    // fallar (en CI el contenedor siempre es fresco).
    await admin.query(`CREATE TABLE IF NOT EXISTS tenants (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      rut varchar(12) NOT NULL UNIQUE,
      business_name varchar(255) NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
    await admin.runMigrations({ transaction: 'all' });

    await admin.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tax_api_e2e') THEN
        CREATE ROLE tax_api_e2e LOGIN PASSWORD 'tax_api_e2e_password' NOSUPERUSER NOBYPASSRLS;
      END IF;
    END $$`);
    await admin.query('GRANT CONNECT ON DATABASE tax_api_e2e TO tax_api_e2e');
    await admin.query('GRANT USAGE ON SCHEMA public TO tax_api_e2e');
    await admin.query('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO tax_api_e2e');
    await admin.query('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO tax_api_e2e');

    await admin.query(
      `INSERT INTO tenants (id, rut, business_name) VALUES ($1, '11111111-1', 'Tenant A'), ($2, '22222222-2', 'Tenant B')
       ON CONFLICT (id) DO NOTHING`,
      [tenantA, tenantB],
    );
    await admin.query(
      `INSERT INTO integration_credentials
       (id, tenant_id, key_id, secret_hash, secret_last4, name, credential_type, permissions, status)
       VALUES ($1, $2, 'cmor_live_e2e_a', 'hash-a', 'aaa1', 'A', 'api', 'dte:emit', 'active'),
              ($3, $4, 'cmor_live_e2e_b', 'hash-b', 'bbb1', 'B', 'api', 'dte:emit', 'active')
       ON CONFLICT (id) DO NOTHING`,
      [credentialA, tenantA, credentialB, tenantB],
    );

    // Limpieza de datos de corridas anteriores (idempotencia local); en CI el
    // contenedor es fresco y esto no elimina nada.
    await admin.query(`DELETE FROM integration_webhook_deliveries`);
    await admin.query(`DELETE FROM integration_webhook_events`);
    await admin.query(`DELETE FROM integration_webhook_endpoints`);
    await admin.query(`DELETE FROM rcof_submissions`);
    await admin.query(`DELETE FROM integration_requests`);
    await admin.query(`DELETE FROM cron_nonces`);

    const parsed = new URL(adminUrl!);
    app = new DataSource({
      type: 'postgres',
      host: parsed.hostname,
      port: Number(parsed.port || 5432),
      database: parsed.pathname.slice(1),
      username: 'tax_api_e2e',
      password: 'tax_api_e2e_password',
      entities: [],
    });
    await app.initialize();
  }, 30_000);

  afterAll(async () => {
    if (app?.isInitialized) await app.destroy();
    if (admin?.isInitialized) await admin.destroy();
  });

  async function insertRequest(tenantId: string, credentialId: string, key: string) {
    return admin.query(
      `INSERT INTO integration_requests
       (tenant_id, kind, idempotency_key, request_hash, payload, origin_credential_id)
       VALUES ($1, 'dte', $2, 'request-hash', '{}'::jsonb, $3)
       RETURNING id`,
      [tenantId, key, credentialId],
    );
  }

  it('runs every migration and creates the worker-aware RLS policies', async () => {
    const migrations = await admin.query('SELECT name FROM typeorm_migrations ORDER BY id');
    expect(migrations.map((row: any) => row.name)).toEqual([
      'AddIntegrationsApi1805000000000',
      'WorkerRlsPolicy1805100000000',
      'EngineTableRls1805200000000',
      'AddCredentialSecretEncrypted1805300000000',
      'AddCronNonces1805400000000',
      'IntegrationRequestResourceKey1805600000000',
      'AllowSystemIntegrationRequests1805800000000',
    ]);
    // Las 4 tablas del motor (dte_documents, etc.) no existen en esta BD de
    // prueba: su política se omite y quedan las 5 de las tablas B2B.
    const policies = await admin.query(
      `SELECT tablename FROM pg_policies WHERE schemaname = 'public' AND policyname LIKE 'tenant_isolation_%'`,
    );
    expect(policies).toHaveLength(5);
    const cronNonces = await admin.query(
      `SELECT 1 FROM information_schema.tables WHERE table_name = 'cron_nonces'`,
    );
    expect(cronNonces).toHaveLength(1);
  });

  it('is fail-closed and isolates two tenants on the real database role', async () => {
    await insertRequest(tenantA, credentialA, 'tenant-a-only');
    await insertRequest(tenantB, credentialB, 'tenant-b-only');

    expect(await app.query('SELECT id FROM integration_requests')).toHaveLength(0);
    const visibleA = await app.transaction(async (manager) => {
      await manager.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantA]);
      return manager.query('SELECT tenant_id FROM integration_requests');
    });
    expect(visibleA).toHaveLength(1);
    expect(visibleA[0].tenant_id).toBe(tenantA);

    await expect(
      app.transaction(async (manager) => {
        await manager.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantA]);
        return manager.query(
          `INSERT INTO integration_requests
           (tenant_id, kind, idempotency_key, request_hash, payload, origin_credential_id)
           VALUES ($1, 'dte', 'cross-tenant', 'hash', '{}'::jsonb, $2)`,
          [tenantB, credentialB],
        );
      }),
    ).rejects.toThrow();
  });

  it('enforces idempotency per tenant without collisions between tenants', async () => {
    await insertRequest(tenantA, credentialA, 'shared-key');
    await insertRequest(tenantB, credentialB, 'shared-key');
    await expect(insertRequest(tenantA, credentialA, 'shared-key')).rejects.toMatchObject({ code: '23505' });
    const rows = await admin.query(`SELECT tenant_id FROM integration_requests WHERE idempotency_key = 'shared-key'`);
    expect(rows).toHaveLength(2);
  });

  it('allows internal durable requests without an API credential while preserving tenant isolation', async () => {
    await admin.query(
      `INSERT INTO integration_requests
       (tenant_id, kind, idempotency_key, request_hash, payload, origin_credential_id)
       VALUES ($1, 'rcof', 'rcof-daily:2026-09-26:1', 'daily-hash', '{"date":"2026-09-26"}'::jsonb, NULL)`,
      [tenantA],
    );
    const visible = await app.transaction(async (manager) => {
      await manager.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantA]);
      return manager.query(`SELECT kind, origin_credential_id FROM integration_requests WHERE kind = 'rcof'`);
    });
    expect(visible).toHaveLength(1);
    expect(visible[0].origin_credential_id).toBeNull();
  });

  it('allows the trusted worker to claim each row at most once concurrently', async () => {
    await insertRequest(tenantA, credentialA, 'claim-a');
    await insertRequest(tenantB, credentialB, 'claim-b');
    const cls = { run: (_ctx: unknown, fn: () => unknown) => fn() } as any;
    const firstClaimer = new IntegrationQueueClaimer(app, {} as any, cls);
    const secondClaimer = new IntegrationQueueClaimer(app, {} as any, cls);
    const [first, second] = await Promise.all([firstClaimer.claimDue(1), secondClaimer.claimDue(1)]);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(first[0].id).not.toBe(second[0].id);
  });

  it('claims concurrent webhook deliveries once and respects the limit', async () => {
    const endpoint = 'cccccccc-0000-4000-8000-000000000001';
    const eventA = 'cccccccc-0000-4000-8000-000000000002';
    const eventB = 'cccccccc-0000-4000-8000-000000000003';
    await admin.query(
      `INSERT INTO integration_webhook_endpoints
       (id, tenant_id, url, secret_cipher, secret_last4, events)
       VALUES ($1, $2, 'https://example.com/hook', '{}', 'test', 'dte.accepted')`,
      [endpoint, tenantA],
    );
    await admin.query(
      `INSERT INTO integration_webhook_events (id, tenant_id, type, payload)
       VALUES ($1, $3, 'dte.accepted', '{}'), ($2, $3, 'dte.accepted', '{}')`,
      [eventA, eventB, tenantA],
    );
    await admin.query(
      `INSERT INTO integration_webhook_deliveries (tenant_id, event_id, endpoint_id)
       VALUES ($1, $2, $4), ($1, $3, $4)`,
      [tenantA, eventA, eventB, endpoint],
    );
    const serviceA = new IntegrationWebhookService({} as any, {} as any, undefined, undefined, app);
    const serviceB = new IntegrationWebhookService({} as any, {} as any, undefined, undefined, app);
    const [first, second] = await Promise.all([
      (serviceA as any).claimDueDeliveries(1),
      (serviceB as any).claimDueDeliveries(1),
    ]);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(first[0].id).not.toBe(second[0].id);
  });
});
