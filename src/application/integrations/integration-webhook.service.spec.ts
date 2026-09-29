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
    await expect(
      service.registerEndpoint(tenantId, { url: 'https://127.0.0.1/admin', events: ['dte.accepted'] }),
    ).rejects.toThrow(/privada o local/);

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

  it('lee como máximo 300 bytes de una respuesta webhook', async () => {
    const cancel = jest.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('a'.repeat(200)));
        controller.enqueue(new TextEncoder().encode('b'.repeat(200)));
      },
      cancel,
    });
    const response = new Response(stream, { status: 200 });

    const snippet = await (service as any).readResponseSnippet(response);

    expect(snippet).toHaveLength(300);
    expect(snippet).toBe('a'.repeat(200) + 'b'.repeat(100));
    expect(cancel).toHaveBeenCalled();
  });

  it('mantiene el timeout durante la lectura del body y reintenta si se vence', async () => {
    await registerEndpoint();
    await service.dispatchForRequest({ tenantId, kind: 'dte', id: 'req-slow-body' } as any, 'submitted', 'x');

    let signal: AbortSignal | undefined;
    let resolveHeaders: (() => void) | undefined;
    const headersReceived = new Promise<void>((resolve) => {
      resolveHeaders = resolve;
    });
    fetchMock.mockImplementation(async (_url: string, init: any) => {
      signal = init.signal;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('headers arrived, body stalls'));
          init.signal.addEventListener('abort', () => controller.error(new Error('body aborted')), { once: true });
        },
      });
      const response = new Response(body, { status: 200 });
      resolveHeaders?.();
      return response;
    });

    jest.useFakeTimers();
    try {
      const delivery = service.deliverDue();
      await headersReceived;
      await jest.advanceTimersByTimeAsync(10_000);
      const result = await delivery;

      expect(signal?.aborted).toBe(true);
      expect(result).toMatchObject({ attempted: 1, delivered: 0, failed: 1 });
      const [stored] = await dataServices.integrationWebhookDelivery.getAll().toPromise();
      expect(stored.status).toBe('pending');
      expect(stored.responseStatus).toBe(200);
      expect(stored.lastError).toMatch(/body aborted/i);
    } finally {
      jest.useRealTimers();
    }
  });

  it('deliveryHistory devuelve las 50 entregas más recientes en orden descendente', async () => {
    const repo = dataServices.integrationWebhookDelivery;
    for (let index = 0; index < 55; index++) {
      await repo.create({
        tenantId,
        eventId: 'event-history',
        endpointId: 'endpoint-history',
        attempt: 1,
        maxAttempts: 6,
        status: 'delivered',
        createdAt: new Date(Date.UTC(2026, 0, index + 1)),
      } as any).toPromise();
    }

    const history = await service.deliveryHistory(tenantId, 'event-history');

    expect(history).toHaveLength(50);
    const stored = await repo.find({ where: { tenantId, eventId: 'event-history' } } as any).toPromise();
    expect(history[0].id).toBe(stored[54].id);
    expect(history[49].id).toBe(stored[5].id);
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
