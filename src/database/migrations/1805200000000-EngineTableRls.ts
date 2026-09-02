import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * RLS fail-closed para las tablas del motor DTE (dte_documents, sii_submissions,
 * tenant_configs, audit_logs): el dato más sensible de la plataforma deja de
 * depender sólo del WHERE de aplicación y queda aislado también a nivel BD.
 *
 * El patrón es el mismo de las tablas B2B (1805000000000 + 1805100000000):
 *  - tenant_id::text = current_setting('app.tenant_id', true) para el API,
 *    que PostgresGenericRepository setea por transacción (fail-closed).
 *  - current_setting('app.worker_scope', true) = 'true' para el worker,
 *    que cruza tenants por diseño.
 *
 * NOTA para consumidores externos de estas tablas (p. ej. el ERP mientras
 * migre a consumir la Tax API por HTTP): DEBE setear app.tenant_id por
 * transacción (SET LOCAL / set_config) o conectar con un rol BYPASSRLS.
 * Las tablas pueden no existir en bases de datos de prueba: se omite
 * la política si falta la tabla.
 */
export class EngineTableRls1805200000000 implements MigrationInterface {
  private readonly tables = [
    'dte_documents',
    'sii_submissions',
    'tenant_configs',
    'audit_logs',
  ];

  private async applyPolicy(queryRunner: QueryRunner, table: string, up: boolean): Promise<void> {
    const exists = await queryRunner.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
      [table],
    );
    if (!exists.length) return;

    if (up) {
      await queryRunner.query(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      await queryRunner.query(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
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
    } else {
      await queryRunner.query(`DROP POLICY IF EXISTS "tenant_isolation_${table}" ON "${table}"`);
      await queryRunner.query(`ALTER TABLE "${table}" NO FORCE ROW LEVEL SECURITY`);
      await queryRunner.query(`ALTER TABLE "${table}" DISABLE ROW LEVEL SECURITY`);
    }
  }

  async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of this.tables) await this.applyPolicy(queryRunner, table, true);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of this.tables) await this.applyPolicy(queryRunner, table, false);
  }
}
