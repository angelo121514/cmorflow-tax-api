import { MigrationInterface, QueryRunner } from "typeorm";

/** Base mínima para una instalación independiente de la Tax API. */
export class CreateStandaloneTaxBase1804900000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS tenants (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), rut varchar(12) UNIQUE NOT NULL,
      business_name varchar(255) NOT NULL, trial_ends_at timestamptz, plan_id varchar,
      gdpr_deleted_at timestamptz, data_retention_until timestamptz, billing_email varchar,
      created_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz
    )`);
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS tenant_configs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid UNIQUE NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      config_json jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz
    )`);
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS dte_documents (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      type integer NOT NULL, folio integer NOT NULL, receiver_rut varchar(20) NOT NULL,
      receiver_name varchar(255) NOT NULL, amount numeric(12,2) NOT NULL, xml_content text NOT NULL,
      signature_value text, status varchar(20) NOT NULL DEFAULT 'BORRADOR', track_id varchar(100),
      status_history jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz,
      CONSTRAINT uq_dte_documents_tenant_type_folio UNIQUE (tenant_id, type, folio)
    )`);
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS sii_submissions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      track_id varchar(100) NOT NULL, status varchar(20) NOT NULL DEFAULT 'PENDIENTE', response_xml text,
      error_message text, submission_type varchar(20) NOT NULL DEFAULT 'DTE', book_operation varchar(10),
      tax_period varchar(7), book_send_type varchar(10), idempotency_key varchar(64),
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz,
      CONSTRAINT uq_sii_submissions_tenant_idempotency UNIQUE (tenant_id, idempotency_key)
    )`);
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS audit_logs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
      user_id uuid, action varchar NOT NULL, ip_address varchar, user_agent text, payload jsonb,
      prev_hash varchar, hash varchar, sequence bigint, created_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz
    )`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_dte_documents_tenant_status_created ON dte_documents (tenant_id, status, created_at)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_sii_submissions_tenant_status ON sii_submissions (tenant_id, status)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_action_created ON audit_logs (tenant_id, action, created_at)`,
    );
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    // CREATE TABLE IF NOT EXISTS puede haber reutilizado tablas del ERP. No
    // se puede probar que sean propiedad de esta migración para eliminarlas.
    throw new Error(
      "La base tributaria no admite rollback destructivo automático. Restaure un respaldo o prepare una migración revisada para su instalación.",
    );
  }
}
