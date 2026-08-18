// backend/src/application/integrations/integration-webhook.service.spec.ts
import { IntegrationWebhookService } from './integration-webhook.service';
import { Aes256Cipher } from '../../infrastructure/framework/crypto/aes-256-cipher';
import { MemoryGenericRepository } from '../../infrastructure/framework/memory/memory-generic-repository';
import { createHmac } from 'crypto';

describe('IntegrationWebhookService — eventos y entregas firmadas', () => {
  const tenantId = 'wh-tenant-1';
  const MASTER_KEY = 'test-master-key-32-chars-minimum!!';
  let dataServices: any;
  let service: IntegrationWebhookService;
  let fetchMock: jest.SpyInstance;

  const registerEndpoint = async (url = 'https://hooks.cliente.cl/cb') => {
    const { endpoint } = await service.registerEndpoint(tenantId, {
      url,
      events: ['dte.submitted', 'dte.accepted'],
    });
    return endpoint;
  };

  beforeEach(() => {
    process.env.SII_MASTER_KEY = MASTER_KEY;
    dataServices = {
      integrationWebhookEndpoint: new MemoryGenericRepository<any>(),
      integrationWebhookEvent: new MemoryGenericRepository<any>(),
      integrationWebhookDelivery: new MemoryGenericRepository<any>(),
    };
    service = new IntegrationWebhookService(dataServices, new Aes256Cipher());
    fetchMock = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchMock.mockRestore();
  });

  it('registro exige HTTPS y eventos del catálogo; el secreto se muestra una vez y queda cifrado', async () => {
    await expect(
      service.registerEndpoint(tenantId, { url: 'http://inseguro.cl', events: ['dte.accepted'] }),
    ).rejects.toThrow(/HTTPS/);
    await expect(
      service.registerEndpoint(tenantId, { url: 'https://x.cl', events: ['evento.inexistente'] }),
    ).rejects.toThrow(/inválidos/);

    const { endpoint, secret } = await service.registerEndpoint(tenantId, {
      url: 'https://hooks.cliente.cl/cb',
      events: ['dte.accepted'],
    });
    expect(secret.startsWith('whsec_')).toBe(true);
    expect(JSON.stringify(endpoint)).not.toContain(secret);
    const stored = await dataServices.integrationWebhookEndpoint.get(endpoint.id).toPromise();
    expect(JSON.parse(stored.secretCipher).ciphertext).toBeDefined();
    // El secreto es recuperable por el emisor (cifrado, no hash) para firmar.
    expect((service as any).decryptSecret(stored)).toBe(secret);
  });

  it('dispatch crea evento + entregas sólo hacia endpoints suscritos', async () => {
    await registerEndpoint();
    await service.registerEndpoint(tenantId, {
      url: 'https://otro.cl/cb',
      events: ['dte.accepted'],
    });

    await service.dispatchForRequest(
      { tenantId, kind: 'dte', id: 'req-1', state: 'submitted', externalReference: null } as any,
      'submitted',
      'Transmitido',
    );

    const events = await dataServices.integrationWebhookEvent.getAll().toPromise();
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('dte.submitted');
    const deliveries = await dataServices.integrationWebhookDelivery.getAll().toPromise();
    expect(deliveries).toHaveLength(1); // sólo el primero suscribe dte.submitted
    expect(deliveries[0].status).toBe('pending');
  });

  it('entrega exitosa: firma HMAC verificable por el consumidor, 2xx → delivered', async () => {
    const endpoint = await registerEndpoint();
    await service.dispatchForRequest(
      { tenantId, kind: 'dte', id: 'req-2' } as any,
      'submitted',
      'Transmitido',
    );

    let captured: any;
    fetchMock.mockImplementation(async (_url: string, init: any) => {
      captured = init;
      return new Response('ok', { status: 200 });
    });

    const result = await service.deliverDue();
    expect(result).toMatchObject({ attempted: 1, delivered: 1, failed: 0 });
    expect(captured.headers['X-CmorFlow-Event-Type']).toBe('dte.submitted');

    // Verificación lado consumidor: HMAC(timestamp + '.' + body) con el secreto.
    const stored = await dataServices.integrationWebhookEndpoint.get(endpoint.id).toPromise();
    const secret = (service as any).decryptSecret(stored);
    const sig = captured.headers['X-CmorFlow-Signature'];
    const expected =
      'sha256=' +
      createHmac('sha256', secret)
        .update(captured.headers['X-CmorFlow-Timestamp'] + '.' + captured.body)
        .digest('hex');
    expect(sig).toBe(expected);

    const deliveries = await dataServices.integrationWebhookDelivery.getAll().toPromise();
    expect(deliveries[0].status).toBe('delivered');
    expect(deliveries[0].responseStatus).toBe(200);
  });

  it('fallo 500 → queda pending con backoff; agotados los intentos → failed', async () => {
    await registerEndpoint();
    await service.dispatchForRequest({ tenantId, kind: 'dte', id: 'req-3' } as any, 'submitted', 'x');
    fetchMock.mockImplementation(async () => new Response('boom', { status: 500 }));

    const first = await service.deliverDue();
    expect(first.delivered).toBe(0);
    let deliveries = await dataServices.integrationWebhookDelivery.getAll().toPromise();
    expect(deliveries[0].status).toBe('pending');
    expect(deliveries[0].lastError).toBe('HTTP 500');
    expect(new Date(deliveries[0].nextAttemptAt).getTime()).toBeGreaterThan(Date.now());

    // Simular que los reintentos ya vencieron y agotar los 6 intentos.
    for (let round = 2; round <= 6; round++) {
      const all = await dataServices.integrationWebhookDelivery.getAll().toPromise();
      await dataServices.integrationWebhookDelivery
        .update(all[0].id, { nextAttemptAt: new Date(Date.now() - 1000) } as any)
        .toPromise();
      await service.deliverDue();
    }
    deliveries = await dataServices.integrationWebhookDelivery.getAll().toPromise();
    expect(deliveries[0].status).toBe('dead');
    expect(deliveries[0].attempt).toBe(6);
  });

  it('redeliver crea entregas inmediatas para diagnóstico', async () => {
    await registerEndpoint();
    await service.dispatchForRequest({ tenantId, kind: 'dte', id: 'req-4' } as any, 'submitted', 'x');
    const events = await dataServices.integrationWebhookEvent.getAll().toPromise();
    fetchMock.mockImplementation(async () => new Response('ok', { status: 200 }));

    const { queued } = await service.redeliver(tenantId, events[0].id);
    expect(queued).toBe(1);
    const result = await service.deliverDue();
    expect(result.delivered).toBeGreaterThanOrEqual(1);
  });
});
