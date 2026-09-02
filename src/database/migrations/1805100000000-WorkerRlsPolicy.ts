import { MigrationInterface, QueryRunner } from 'typeorm';

/** Allows the trusted background worker to discover cross-tenant jobs while
 * preserving tenant isolation for ordinary API transactions. */
export class WorkerRlsPolicy1805100000000 implements MigrationInterface {
  private readonly tables = [
    'integration_requests', 'rcof_submissions', 'integration_webhook_endpoints',
    'integration_webhook_events', 'integration_webhook_deliveries',
  ];

  async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of this.tables) {
      await queryRunner.query(`DROP POLICY IF EXISTS "tenant_isolation_${table}" ON "${table}"`);
      await queryRunner.query(`CREATE POLICY "tenant_isolation_${table}" ON "${table}"
        USING (
          tenant_id::text = current_setting('app.tenant_id', true)
          OR current_setting('app.worker_scope', true) = 'true'
        )
        WITH CHECK (
          tenant_id::text = current_setting('app.tenant_id', true)
          OR current_setting('app.worker_scope', true) = 'true'
        )`);
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of this.tables) {
      await queryRunner.query(`DROP POLICY IF EXISTS "tenant_isolation_${table}" ON "${table}"`);
      await queryRunner.query(`CREATE POLICY "tenant_isolation_${table}" ON "${table}"
        USING (tenant_id::text = current_setting('app.tenant_id', true))
        WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true))`);
    }
  }
}
