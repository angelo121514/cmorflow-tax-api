import { MigrationInterface, QueryRunner } from "typeorm";

export class TransmissionRecoveryFence1805900000000 implements MigrationInterface {
  name = "TransmissionRecoveryFence1805900000000";
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "ALTER TABLE integration_requests ADD COLUMN IF NOT EXISTS transmission_started_at timestamptz",
    );
  }
  async down(): Promise<void> {
    throw new Error(
      "No se elimina el marcador de envío: conciliar envíos ambiguos antes de una migración manual revisada.",
    );
  }
}
