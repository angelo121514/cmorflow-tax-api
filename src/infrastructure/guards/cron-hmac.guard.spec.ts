import { createHmac } from 'crypto';
import { CronHmacGuard } from './cron-hmac.guard';

describe('CronHmacGuard', () => {
  const secret = 'cron-test-secret';
  const body = JSON.stringify({ job: 'process-integrations' });
  const context = (timestamp: string, nonce: string, signature: string) => ({
    switchToHttp: () => ({ getRequest: () => ({ rawBody: Buffer.from(body), headers: {
      'x-cron-timestamp': timestamp, 'x-cron-nonce': nonce, 'x-cron-signature': signature,
    } }) }),
  } as any);

  beforeEach(() => { process.env.CRON_HMAC_SECRET = secret; });

  it('firma timestamp, nonce y body; bloquea replay del nonce (mapa en memoria)', async () => {
    const guard = new CronHmacGuard();
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = 'unique-nonce';
    const signature = createHmac('sha256', secret).update(`${timestamp}.${nonce}.${body}`).digest('hex');
    await expect(guard.canActivate(context(timestamp, nonce, signature))).resolves.toBe(true);
    await expect(guard.canActivate(context(timestamp, nonce, signature))).rejects.toThrow(/Nonce/);
  });

  it('rechaza la firma antigua que sólo cubría el body', async () => {
    const guard = new CronHmacGuard();
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = createHmac('sha256', secret).update(body).digest('hex');
    await expect(guard.canActivate(context(timestamp, 'nonce-2', signature))).rejects.toThrow(/inválida/);
  });

  it('con store en BD persiste nonces: rechaza replay y acepta nonces nuevos', async () => {
    const consumed: string[] = [];
    const store = {
      available: true,
      tryConsume: jest.fn(async (nonce: string) => {
        if (consumed.includes(nonce)) return false;
        consumed.push(nonce);
        return true;
      }),
    };
    const guard = new CronHmacGuard(store as any);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const sign = (nonce: string) => createHmac('sha256', secret).update(`${timestamp}.${nonce}.${body}`).digest('hex');
    await expect(guard.canActivate(context(timestamp, 'db-nonce-1', sign('db-nonce-1')))).resolves.toBe(true);
    await expect(guard.canActivate(context(timestamp, 'db-nonce-1', sign('db-nonce-1')))).rejects.toThrow(/Nonce/);
    await expect(guard.canActivate(context(timestamp, 'db-nonce-2', sign('db-nonce-2')))).resolves.toBe(true);
    expect(store.tryConsume).toHaveBeenCalledTimes(3);
  });
});
