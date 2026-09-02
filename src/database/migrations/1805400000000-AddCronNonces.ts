import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Nonces anti-replay del CronHmacGuard persistidos en BD (antes en memoria:
 * un restart o N instancias permitían replay dentro de la ventana de 5 min).
 */
export class AddCronNonces1805400000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "cron_nonces" (
        "nonce" varchar(128) PRIMARY KEY,
        "expires_at" timestamptz NOT NULL
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_cron_nonces_expires" ON "cron_nonces" ("expires_at")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "cron_nonces"`);
  }
}
