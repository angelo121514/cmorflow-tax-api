import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * API B2B /integrations: credenciales HMAC, nonces antireplay, solicitudes
 * asíncronas (cola durable), RCOF persistido y webhooks salientes.
 *
 * Notas de seguridad:
 * - integration_credentials e integration_nonces NO tienen RLS: son tablas
 *   de lookup global (el guard resuelve el tenant desde la credencial antes
 *   de existir contexto CLS). El secreto sólo se guarda hasheado (SHA-256).
 * - El resto replica el patrón fail-closed tenant_isolation (RLS + FORCE).
 * - integration_requests exterioriza la unicidad de idempotencia y de
 *   externalReference por tenant a nivel de constraint.
 */
export class AddIntegrationsApi1805000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "integration_credentials" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "key_id" varchar NOT NULL,
        "secret_hash" varchar NOT NULL,
        "secret_last4" varchar(8) NOT NULL,
        "name" varchar NOT NULL,
        "credential_type" varchar(8) NOT NULL DEFAULT 'api',
        "permissions" text NOT NULL,
        "status" varchar(16) NOT NULL DEFAULT 'active',
        "expires_at" timestamptz,
        "last_used_at" timestamptz,
        "rotated_from_id" uuid,
        "revoked_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_integration_credentials" PRIMARY KEY ("id"),
        CONSTRAINT "FK_integration_credentials_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
        CONSTRAINT "UQ_integration_credentials_key_id" UNIQUE ("key_id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_integration_credentials_tenant" ON "integration_credentials" ("tenant_id")`);

    await queryRunner.query(`
      CREATE TABLE "integration_nonces" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "credential_id" uuid NOT NULL,
        "nonce" varchar NOT NULL,
        "expires_at" timestamptz NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_integration_nonces" PRIMARY KEY ("id"),
        CONSTRAINT "FK_integration_nonces_credential" FOREIGN KEY ("credential_id") REFERENCES "integration_credentials"("id") ON DELETE CASCADE,
        CONSTRAINT "UQ_integration_nonces_credential_nonce" UNIQUE ("credential_id", "nonce")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_integration_nonces_expires" ON "integration_nonces" ("expires_at")`);

    await queryRunner.query(`
      CREATE TABLE "integration_requests" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "kind" varchar(16) NOT NULL,
        "idempotency_key" varchar NOT NULL,
        "request_hash" varchar NOT NULL,
        "external_reference" varchar,
        "payload" jsonb NOT NULL,
        "metadata" jsonb,
        "state" varchar(16) NOT NULL DEFAULT 'queued',
        "dte_id" uuid,
        "rcof_id" uuid,
        "origin_credential_id" uuid NOT NULL,
        "attempts" integer NOT NULL DEFAULT 0,
        "max_attempts" integer NOT NULL DEFAULT 5,
        "next_attempt_at" timestamptz NOT NULL DEFAULT now(),
        "locked_at" timestamptz,
        "last_error" jsonb,
        "state_history" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "response_snapshot" jsonb,
        "submitted_at" timestamptz,
        "finalized_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_integration_requests" PRIMARY KEY ("id"),
        CONSTRAINT "FK_integration_requests_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_integration_requests_credential" FOREIGN KEY ("origin_credential_id") REFERENCES "integration_credentials"("id"),
        CONSTRAINT "UQ_integration_requests_tenant_key" UNIQUE ("tenant_id", "idempotency_key"),
        CONSTRAINT "UQ_integration_requests_tenant_extref" UNIQUE ("tenant_id", "external_reference")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_integration_requests_state_next_attempt" ON "integration_requests" ("state", "next_attempt_at")`);
    await queryRunner.query(`CREATE INDEX "IDX_integration_requests_tenant_state" ON "integration_requests" ("tenant_id", "state")`);
    await queryRunner.query(`CREATE INDEX "IDX_integration_requests_dte" ON "integration_requests" ("dte_id")`);

    await queryRunner.query(`
      CREATE TABLE "rcof_submissions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "period_date" date NOT NULL,
        "sequence" integer NOT NULL,
        "xml_content" text NOT NULL,
        "track_id" varchar,
        "status" varchar(16) NOT NULL DEFAULT 'submitted',
        "sii_response" jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_rcof_submissions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_rcof_submissions_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
        CONSTRAINT "UQ_rcof_submissions_tenant_period_seq" UNIQUE ("tenant_id", "period_date", "sequence")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_rcof_submissions_status" ON "rcof_submissions" ("status")`);

    await queryRunner.query(`
      CREATE TABLE "integration_webhook_endpoints" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "url" varchar NOT NULL,
        "secret_cipher" text NOT NULL,
        "secret_last4" varchar(8) NOT NULL,
        "events" text NOT NULL,
        "active" boolean NOT NULL DEFAULT true,
        "description" varchar,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_integration_webhook_endpoints" PRIMARY KEY ("id"),
        CONSTRAINT "FK_integration_webhook_endpoints_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_integration_webhook_endpoints_tenant" ON "integration_webhook_endpoints" ("tenant_id")`);

    await queryRunner.query(`
      CREATE TABLE "integration_webhook_events" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "type" varchar NOT NULL,
        "request_id" uuid,
        "rcof_id" uuid,
        "payload" jsonb NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_integration_webhook_events" PRIMARY KEY ("id"),
        CONSTRAINT "FK_integration_webhook_events_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_integration_webhook_events_tenant" ON "integration_webhook_events" ("tenant_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_integration_webhook_events_request" ON "integration_webhook_events" ("request_id")`);

    await queryRunner.query(`
      CREATE TABLE "integration_webhook_deliveries" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "event_id" uuid NOT NULL,
        "endpoint_id" uuid NOT NULL,
        "attempt" integer NOT NULL DEFAULT 0,
        "max_attempts" integer NOT NULL DEFAULT 6,
        "status" varchar(16) NOT NULL DEFAULT 'pending',
        "next_attempt_at" timestamptz NOT NULL DEFAULT now(),
        "response_status" integer,
        "response_snippet" varchar,
        "last_error" varchar,
        "delivered_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_integration_webhook_deliveries" PRIMARY KEY ("id"),
        CONSTRAINT "FK_integration_webhook_deliveries_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_integration_webhook_deliveries_event" FOREIGN KEY ("event_id") REFERENCES "integration_webhook_events"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_integration_webhook_deliveries_endpoint" FOREIGN KEY ("endpoint_id") REFERENCES "integration_webhook_endpoints"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_integration_webhook_deliveries_due" ON "integration_webhook_deliveries" ("status", "next_attempt_at")`);
    await queryRunner.query(`CREATE INDEX "IDX_integration_webhook_deliveries_event" ON "integration_webhook_deliveries" ("event_id")`);

    // RLS fail-closed en tablas tenant-scoped (patrón 1804700000000).
    // credentials/nonces quedan sin RLS por ser lookup global del guard.
    const rlsTables = [
      'integration_requests',
      'rcof_submissions',
      'integration_webhook_endpoints',
      'integration_webhook_events',
      'integration_webhook_deliveries',
    ];
    for (const table of rlsTables) {
      await queryRunner.query(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY;`);
      await queryRunner.query(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY;`);
      await queryRunner.query(`CREATE POLICY "tenant_isolation_${table}" ON "${table}"
        USING (tenant_id::text = current_setting('app.tenant_id', true))
        WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const rlsTables = [
      'integration_webhook_deliveries',
      'integration_webhook_events',
      'integration_webhook_endpoints',
      'rcof_submissions',
      'integration_requests',
    ];
    for (const table of rlsTables) {
      await queryRunner.query(`DROP POLICY IF EXISTS "tenant_isolation_${table}" ON "${table}";`);
      await queryRunner.query(`ALTER TABLE "${table}" NO FORCE ROW LEVEL SECURITY;`);
      await queryRunner.query(`ALTER TABLE "${table}" DISABLE ROW LEVEL SECURITY;`);
    }
    await queryRunner.query(`DROP TABLE IF EXISTS "integration_webhook_deliveries"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "integration_webhook_events"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "integration_webhook_endpoints"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "rcof_submissions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "integration_requests"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "integration_nonces"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "integration_credentials"`);
  }
}
