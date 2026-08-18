// backend/src/application/integrations/integration-processor.service.spec.ts
import { IntegrationProcessorService } from './integration-processor.service';
import { IntegrationStateService } from './integration-state.service';
import { IntegrationQueueClaimer } from './integration-queue.claimer';
import { MemoryGenericRepository } from '../../infrastructure/framework/memory/memory-generic-repository';
import { of } from 'rxjs';
import { IntegrationRequestEntity, DteDocumentEntity } from '@domain';

describe('IntegrationProcessorService — folio único, reintentos y polling', () => {
  const tenantId = 'proc-tenant-1';
  let repo: MemoryGenericRepository<IntegrationRequestEntity>;
  let dteRepo: MemoryGenericRepository<DteDocumentEntity>;
  let dataServices: any;
  let processor: IntegrationProcessorService;
  let emitDteUseCase: any;
  let queryDteStatusUseCase: any;
  let generateRcofUseCase: any;
  let stateService: IntegrationStateService;
  let cls: any;
  const dispatcher = { dispatchForRequest: jest.fn(), dispatchForRcof: jest.fn() };

  const seedRequest = async (overrides: any = {}) => {
    const created = await repo
      .create({
        tenantId,
        kind: 'dte',
        idempotencyKey: 'k-' + Math.random().toString(36).slice(2),
        requestHash: 'h',
        state: 'queued',
        originCredentialId: 'cred-1',
        attempts: 0,
        maxAttempts: 5,
        nextAttemptAt: new Date(),
        stateHistory: [],
        payload: {
          documentType: 39,
          items: [{ name: 'Agua', quantity: 1, unitPrice: 1000 }],
          serverTotals: { totalAmount: 1190 },
        },
        ...overrides,
      } as any)
      .toPromise();
    return created!;
  };

  beforeAll(() => {
    cls = { run: (_s: any, fn: any) => fn(), set: () => undefined };
  });

  beforeEach(() => {
    repo = new MemoryGenericRepository<IntegrationRequestEntity>();
    dteRepo = new MemoryGenericRepository<DteDocumentEntity>();
    dataServices = {
      integrationRequest: repo,
      dteDocument: dteRepo,
      rcofSubmission: new MemoryGenericRepository<any>(),
    };
    stateService = new IntegrationStateService(dataServices, dispatcher as any);
    emitDteUseCase = {
      prepare: jest.fn(),
      transmit: jest.fn(),
    };
    queryDteStatusUseCase = { execute: jest.fn().mockReturnValue(of({})) };
    generateRcofUseCase = { execute: jest.fn(), pollStatus: jest.fn(), transmit: jest.fn() };

    const claimer = new IntegrationQueueClaimer(
      { query: () => { throw new Error('stub datasource'); } } as any,
      dataServices,
      { run: (_s: any, fn: any) => fn() } as any,
    );
    (claimer as any).isTestEnvironment = () => true;

    processor = new IntegrationProcessorService(
      dataServices,
      { run: (_s: any, fn: any) => fn(), set: () => undefined } as any,
      claimer,
      stateService,
      emitDteUseCase,
      queryDteStatusUseCase,
      generateRcofUseCase,
    );
    // Marcar entorno de test para el fallback memory del claimer.
    process.env.JEST_WORKER_ID = process.env.JEST_WORKER_ID || '1';
    jest.clearAllMocks();
  });

  it('happy path: prepare UNA vez → dteId persistido → transmit → submitted', async () => {
    const request = await seedRequest();
    const dte = await dteRepo
      .create({ tenantId, type: 39, folio: 100, status: 'FIRMADO' } as any)
      .toPromise();
    emitDteUseCase.prepare.mockReturnValue(of({ id: dte!.id, folio: 100 }));
    emitDteUseCase.transmit.mockReturnValue(of({ trackId: 'TRACK-1' }));

    await processor.processDue(5);

    expect(emitDteUseCase.prepare).toHaveBeenCalledTimes(1);
    expect(emitDteUseCase.transmit).toHaveBeenCalledTimes(1);
    const updated = await repo.get(request.id!).toPromise();
    expect(updated!.dteId).toBe(dte!.id);
    expect(updated!.state).toBe('submitted');
    expect(dispatcher.dispatchForRequest).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'submitted' }),
      'submitted',
      expect.stringContaining('TRACK-1'),
    );
  });

  it('REINTENTO CON FOLIO ÚNICO: con dteId ya fijado jamás vuelve a prepare', async () => {
    const dte = await dteRepo
      .create({ tenantId, type: 39, folio: 100, status: 'BORRADOR' } as any)
      .toPromise();
    await seedRequest({ state: 'processing', dteId: dte!.id, nextAttemptAt: new Date() });
    emitDteUseCase.transmit.mockReturnValue(of({ trackId: 'TRACK-2' }));

    await processor.processDue(5);

    expect(emitDteUseCase.prepare).not.toHaveBeenCalled();
    expect(emitDteUseCase.transmit).toHaveBeenCalledTimes(1);
  });

  it('fallo de transmisión → reintento programado con backoff (no failed prematuro)', async () => {
    await seedRequest();
    const dte = await dteRepo
      .create({ tenantId, type: 39, folio: 101, status: 'FIRMADO' } as any)
      .toPromise();
    emitDteUseCase.prepare.mockReturnValue(of({ id: dte!.id, folio: 101 }));
    const { throwError } = require('rxjs');
    emitDteUseCase.transmit.mockReturnValue(
      throwError(() => new Error('SiiConnectionError: timeout')),
    );

    await processor.processDue(5);

    const updated = (await repo.getAll().toPromise())!.find(
      (r: any) => r.dteId === dte!.id,
    )!;
    expect(updated.state).not.toBe('failed');
    expect(updated.lastError.code).toBe('SII_UNAVAILABLE');
    expect(new Date(updated.nextAttemptAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('pollSubmitted consolida ACEPTADO del DTE → estado público accepted + evento', async () => {
    const dte = await dteRepo
      .create({ tenantId, type: 39, folio: 102, status: 'ENVIADO', trackId: 'TRACK-9' } as any)
      .toPromise();
    const request = await seedRequest({
      state: 'submitted',
      dteId: dte!.id,
      submittedAt: new Date(),
    });
    // El use case de consulta "actualiza" el DTE a ACEPTADO (como haría el SII).
    queryDteStatusUseCase.execute.mockImplementation(() => {
      dteRepo.update(dte!.id!, { status: 'ACEPTADO' } as any).toPromise();
      return of({ status: 'ACEPTADO' });
    });

    await processor.pollSubmitted();

    const updated = await repo.get(request.id!).toPromise();
    expect(updated!.state).toBe('accepted');
    expect(updated!.finalizedAt).toBeInstanceOf(Date);
    expect(dispatcher.dispatchForRequest).toHaveBeenCalledWith(
      expect.anything(),
      'accepted',
      expect.stringContaining('TRACK-9'),
    );
  });

  it('kind=rcof delega en GenerateRcofUseCase y vincula rcofId', async () => {
    await seedRequest({
      kind: 'rcof',
      payload: { date: '2026-08-14', sequenceNumber: 1 },
    });
    generateRcofUseCase.execute.mockResolvedValue({
      id: 'rcof-1',
      trackId: 'TRACK-RCOF',
      status: 'submitted',
    });

    await processor.processDue(5);

    expect(generateRcofUseCase.execute).toHaveBeenCalledWith(tenantId, {
      date: '2026-08-14',
      sequenceNumber: 1,
    });
    const updated = (await repo.getAll().toPromise())!.find((r: any) => r.kind === 'rcof')!;
    expect(updated.rcofId).toBe('rcof-1');
    expect(updated.state).toBe('submitted');
  });
});
