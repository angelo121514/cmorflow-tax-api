import { MigrationInterface, QueryRunner } from 'typeorm';

/** Permite requests creadas por trabajos internos, como el RCOF diario. */
export class AllowSystemIntegrationRequests1805800000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "integration_requests" ALTER COLUMN "origin_credential_id" DROP NOT NULL`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const [result] = await queryRunner.query(
      `SELECT count(*)::int AS count FROM "integration_requests" WHERE "origin_credential_id" IS NULL`,
    );
    if (Number(result?.count || 0) > 0) {
      throw new Error('No se puede revertir: existen solicitudes internas sin credencial de origen.');
    }
    await queryRunner.query(
      `ALTER TABLE "integration_requests" ALTER COLUMN "origin_credential_id" SET NOT NULL`,
    );
  }
}
