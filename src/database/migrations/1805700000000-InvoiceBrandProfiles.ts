import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Perfiles visuales versionados para las representaciones PDF de DTE.
 *
 * La referencia desde dte_documents es deliberadamente nullable: los DTE ya
 * emitidos no tenían un snapshot visual y se reconstruyen con el diseño
 * neutro basado en XML; los nuevos fijan una versión al crearse.
 */
export class InvoiceBrandProfiles1805700000000 implements MigrationInterface {
  private readonly table = 'invoice_brand_profiles';
  private readonly policy = 'tenant_isolation_invoice_brand_profiles';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "${this.table}" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "version" integer NOT NULL,
        "logo_data" bytea,
        "logo_mime_type" varchar(32),
        "logo_sha256" varchar(64),
        "primary_color" varchar(7) NOT NULL,
        "secondary_color" varchar(7) NOT NULL,
        "created_by_credential_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_invoice_brand_profiles" PRIMARY KEY ("id"),
        CONSTRAINT "FK_invoice_brand_profiles_tenant"
          FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_invoice_brand_profiles_credential"
          FOREIGN KEY ("created_by_credential_id") REFERENCES "integration_credentials"("id") ON DELETE SET NULL,
        CONSTRAINT "UQ_invoice_brand_profiles_tenant_version" UNIQUE ("tenant_id", "version"),
        CONSTRAINT "UQ_invoice_brand_profiles_id_tenant" UNIQUE ("id", "tenant_id"),
        CONSTRAINT "CHK_invoice_brand_profiles_version" CHECK ("version" > 0),
        CONSTRAINT "CHK_invoice_brand_profiles_primary_color"
          CHECK ("primary_color" ~ '^#[0-9A-Fa-f]{6}$'),
        CONSTRAINT "CHK_invoice_brand_profiles_secondary_color"
          CHECK ("secondary_color" ~ '^#[0-9A-Fa-f]{6}$'),
        CONSTRAINT "CHK_invoice_brand_profiles_logo_fields"
          CHECK (
            ("logo_data" IS NULL AND "logo_mime_type" IS NULL AND "logo_sha256" IS NULL)
            OR
            ("logo_data" IS NOT NULL AND "logo_mime_type" IN ('image/png', 'image/jpeg') AND "logo_sha256" IS NOT NULL)
          )
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_invoice_brand_profiles_tenantId" ON "${this.table}" ("tenant_id")`);
    // La aplicación ya crea una fila nueva por cada PUT. El trigger protege la
    // misma regla ante futuras rutas de repositorio o SQL administrativo.
    await queryRunner.query(`CREATE OR REPLACE FUNCTION prevent_invoice_brand_profile_update()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'invoice_brand_profiles are immutable; create a new version instead';
      END;
      $$ LANGUAGE plpgsql`);
    await queryRunner.query(`DROP TRIGGER IF EXISTS "TRG_invoice_brand_profiles_immutable" ON "${this.table}"`);
    await queryRunner.query(`CREATE TRIGGER "TRG_invoice_brand_profiles_immutable"
      BEFORE UPDATE ON "${this.table}"
      FOR EACH ROW EXECUTE FUNCTION prevent_invoice_brand_profile_update()`);

    await queryRunner.query(`ALTER TABLE "dte_documents" ADD COLUMN IF NOT EXISTS "brand_profile_id" uuid`);
    await queryRunner.query(`ALTER TABLE "dte_documents" DROP CONSTRAINT IF EXISTS "FK_dte_documents_brand_profile"`);
    await queryRunner.query(`ALTER TABLE "dte_documents"
      ADD CONSTRAINT "FK_dte_documents_brand_profile"
      FOREIGN KEY ("brand_profile_id", "tenant_id")
      REFERENCES "${this.table}"("id", "tenant_id") ON DELETE RESTRICT`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_dte_documents_brand_profile" ON "dte_documents" ("brand_profile_id")`);
    // El vínculo forma parte de la representación histórica del DTE: una vez
    // emitido, no puede apuntar a otra versión de marca (ni completarse a
    // posteriori si nació sin una). Sólo INSERT puede fijar el snapshot.
    await queryRunner.query(`CREATE OR REPLACE FUNCTION prevent_dte_brand_profile_snapshot_change()
      RETURNS trigger AS $$
      BEGIN
        IF NEW.brand_profile_id IS DISTINCT FROM OLD.brand_profile_id THEN
          RAISE EXCEPTION 'dte_documents.brand_profile_id is immutable after issuance';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql`);
    await queryRunner.query(`DROP TRIGGER IF EXISTS "TRG_dte_documents_brand_profile_immutable" ON "dte_documents"`);
    await queryRunner.query(`CREATE TRIGGER "TRG_dte_documents_brand_profile_immutable"
      BEFORE UPDATE OF "brand_profile_id" ON "dte_documents"
      FOR EACH ROW EXECUTE FUNCTION prevent_dte_brand_profile_snapshot_change()`);

    // Perfiles contienen logos y deben respetar el mismo aislamiento fail-closed
    // que el resto de datos tributarios del tenant.
    await queryRunner.query(`ALTER TABLE "${this.table}" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "${this.table}" FORCE ROW LEVEL SECURITY`);
    await queryRunner.query(`DROP POLICY IF EXISTS "${this.policy}" ON "${this.table}"`);
    await queryRunner.query(`CREATE POLICY "${this.policy}" ON "${this.table}"
      USING (
        tenant_id::text = current_setting('app.tenant_id', true)
        OR current_setting('app.worker_scope', true) = 'true'
      )
      WITH CHECK (
        tenant_id::text = current_setting('app.tenant_id', true)
        OR current_setting('app.worker_scope', true) = 'true'
      )`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER IF EXISTS "TRG_dte_documents_brand_profile_immutable" ON "dte_documents"`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS prevent_dte_brand_profile_snapshot_change()`);
    await queryRunner.query(`ALTER TABLE "dte_documents" DROP CONSTRAINT IF EXISTS "FK_dte_documents_brand_profile"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_dte_documents_brand_profile"`);
    await queryRunner.query(`ALTER TABLE "dte_documents" DROP COLUMN IF EXISTS "brand_profile_id"`);

    await queryRunner.query(`DROP POLICY IF EXISTS "${this.policy}" ON "${this.table}"`);
    await queryRunner.query(`DROP TRIGGER IF EXISTS "TRG_invoice_brand_profiles_immutable" ON "${this.table}"`);
    await queryRunner.query(`ALTER TABLE "${this.table}" NO FORCE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "${this.table}" DISABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`DROP TABLE IF EXISTS "${this.table}"`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS prevent_invoice_brand_profile_update()`);
  }
}
