// backend/src/application/integrations/integration-state.service.spec.ts
import { IntegrationStateService, INTEGRATION_RETRY_BACKOFF_MS } from './integration-state.service';
import { MemoryGenericRepository } from '../../infrastructure/framework/memory/memory-generic-repository';
import { IntegrationRequestEntity } from '@domain';

describe('IntegrationStateService — transiciones y backoff', () => {
  let repo: MemoryGenericRepository<IntegrationRequestEntity>;
  let stateService: IntegrationStateService;
  const dispatcher = { dispatchForRequest: jest.fn(), dispatchForRcof: jest.fn() };

  const seedRequest = async (overrides: any = {}) => {
    const created = await repo
      .create({
        tenantId: 't1',
        kind: 'dte',
        idempotencyKey: 'k1',
        requestHash: 'h1',
        state: 'queued',
        originCredentialId: 'c1',
        attempts: 0,
        maxAttempts: 5,
        nextAttemptAt: new Date(),
        stateHistory: [],
        ...overrides,
      } as any)
      .toPromise();
    return created!;
  };

  beforeEach(() => {
    repo = new MemoryGenericRepository<IntegrationRequestEntity>();
    const dataServices: any = { integrationRequest: repo };
    stateService = new IntegrationStateService(dataServices, dispatcher as any);
    jest.clearAllMocks();
  });

  it('applyState registra historia y finaliza en estados terminales', async () => {
    const request = await seedRequest();
    const processing = await stateService.applyState(request, 'processing', 'en trabajo');
    const submitted = await stateService.applyState(processing, 'submitted', 'Transmitido');
    expect(submitted.state).toBe('submitted');
    expect(submitted.submittedAt).toBeInstanceOf(Date);
    expect(submitted.stateHistory).toHaveLength(2);

    const accepted = await stateService.applyState(submitted, 'accepted', 'SII ACEPTADO');
    expect(accepted.state).toBe('accepted');
    expect(accepted.finalizedAt).toBeInstanceOf(Date);
    expect(accepted.stateHistory.at(-1)).toMatchObject({ state: 'accepted' });
  });

  it('dispara webhook para estados notificables, no para intermediarios', async () => {
    const request = await seedRequest();
    await stateService.applyState(request, 'processing', 'en trabajo');
    expect(dispatcher.dispatchForRequest).not.toHaveBeenCalled();
    await stateService.applyState(request, 'submitted', 'Transmitido');
    expect(dispatcher.dispatchForRequest).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'submitted' }),
      'submitted',
      'Transmitido',
    );
  });

  it('transición al mismo estado es no-op', async () => {
    const request = await seedRequest({ state: 'submitted' });
    const result = await stateService.applyState(request, 'submitted', 'repetido');
    expect(result.stateHistory).toHaveLength(0);
  });

  it('scheduleRetry aplica backoff creciente y falla al agotar intentos', async () => {
    let request = await seedRequest({ state: 'processing' });
    request = await stateService.scheduleRetry(request, {
      code: 'SII_UNAVAILABLE',
      message: 'timeout',
      retryable: true,
    });
    expect(request.attempts).toBe(1);
    expect(new Date(request.nextAttemptAt).getTime()).toBeGreaterThan(Date.now());

    // Agotar los 5 intentos.
    for (let i = 2; i <= 5; i++) {
      request = await stateService.scheduleRetry(request, {
        code: 'SII_UNAVAILABLE',
        message: 'timeout',
        retryable: true,
      });
    }
    expect(request.state).toBe('failed');
    expect(request.finalizedAt).toBeInstanceOf(Date);
    expect(dispatcher.dispatchForRequest).toHaveBeenCalledWith(
      expect.anything(),
      'failed',
      expect.stringContaining('Reintentos agotados'),
    );
    expect(INTEGRATION_RETRY_BACKOFF_MS).toHaveLength(5);
  });
});
