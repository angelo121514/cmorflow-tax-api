import { Inject, Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';

/**
 * Persistencia de nonces anti-replay del CronHmacGuard (tabla cron_nonces).
 *
 * Vive en el módulo de datos porque ahí sí es visible el DataSource de
 * forRootAsync. `available` es false sin BD (tests): el guard entonces cae a
 * su mapa en memoria, válido sólo con una instancia.
 */
@Injectable()
export class CronNonceStore {
  constructor(@Optional() @Inject(DataSource) private readonly dataSource?: DataSource) {}

  get available(): boolean {
    return this.dataSource?.isInitialized === true;
  }

  /** true si el nonce era nuevo (consumido ahora); false si ya existía (replay). */
  async tryConsume(nonce: string, ttlSeconds: number): Promise<boolean> {
    if (!this.available) return true;
    const manager = this.dataSource!.manager;
    await manager.query(`DELETE FROM cron_nonces WHERE expires_at < now()`);
    const inserted = await manager.query(
      `INSERT INTO cron_nonces (nonce, expires_at)
       VALUES ($1, now() + ($2 || ' seconds')::interval)
       ON CONFLICT (nonce) DO NOTHING
       RETURNING nonce`,
      [nonce, String(ttlSeconds)],
    );
    return inserted.length > 0;
  }
}
