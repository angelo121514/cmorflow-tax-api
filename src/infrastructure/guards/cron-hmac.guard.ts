import { CanActivate, ExecutionContext, Injectable, Optional, UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { CronNonceStore } from '../framework/postgres/cron-nonce.store';

const CRON_NONCE_TTL_SECONDS = 300;

/**
 * Guard HMAC de los endpoints internos de cron (fallback del worker).
 *
 * Los nonces anti-replay se persisten en BD (cron_nonces vía CronNonceStore):
 * sobreviven restarts y son correctos con N instancias. Sin store disponible
 * (tests) se usa el mapa en memoria, válido sólo para una instancia.
 */
@Injectable()
export class CronHmacGuard implements CanActivate {
  private readonly consumed = new Map<string, number>();

  constructor(@Optional() private readonly cronNonceStore?: CronNonceStore) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const secret = process.env.CRON_HMAC_SECRET;
    const timestamp = request.headers['x-cron-timestamp'] as string | undefined;
    const signature = request.headers['x-cron-signature'] as string | undefined;
    const nonce = request.headers['x-cron-nonce'] as string | undefined;
    if (!secret || !timestamp || !signature || !nonce) throw new UnauthorizedException('Firma cron requerida.');
    const ts = Number(timestamp);
    if (!Number.isInteger(ts) || Math.abs(Date.now() / 1000 - ts) > 300) {
      throw new UnauthorizedException('Timestamp cron fuera de ventana.');
    }
    const rawBody = request.rawBody ?? JSON.stringify(request.body ?? {});
    const expected = createHmac('sha256', secret).update(`${timestamp}.${nonce}.${rawBody}`).digest('hex');
    const supplied = Buffer.from(signature, 'hex');
    const calculated = Buffer.from(expected, 'hex');
    if (supplied.length !== calculated.length || !timingSafeEqual(supplied, calculated)) {
      throw new UnauthorizedException('Firma cron inválida.');
    }
    await this.consumeNonce(nonce);
    return true;
  }

  private async consumeNonce(nonce: string): Promise<void> {
    if (!this.cronNonceStore?.available) {
      this.consumeNonceInMemory(nonce);
      return;
    }
    const isNew = await this.cronNonceStore.tryConsume(nonce, CRON_NONCE_TTL_SECONDS);
    if (!isNew) throw new UnauthorizedException('Nonce cron ya utilizado.');
  }

  private consumeNonceInMemory(nonce: string): void {
    const now = Date.now();
    for (const [value, expires] of this.consumed) if (expires <= now) this.consumed.delete(value);
    if (this.consumed.has(nonce)) throw new UnauthorizedException('Nonce cron ya utilizado.');
    this.consumed.set(nonce, now + CRON_NONCE_TTL_SECONDS * 1000);
  }
}
