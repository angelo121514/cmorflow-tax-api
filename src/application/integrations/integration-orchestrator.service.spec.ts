import { IntegrationOrchestratorService } from './integration-orchestrator.service';
import { GenerateRcofUseCase } from './generate-rcof.use-case';
import { of } from 'rxjs';

describe('IntegrationOrchestratorService database result normalization', () => {
  it('returns the affected row count reported by TypeORM/pg when purging nonces', async () => {
    const dataSource = { query: jest.fn().mockResolvedValue([[], 7]) } as any;
    const service = new IntegrationOrchestratorService(
      {} as any,
      {} as any,
      dataSource,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await expect((service as any).purgeNonces()).resolves.toBe(7);
  });
});

describe('IntegrationOrchestratorService daily RCOF durable requests', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const tenant = { id: tenantId };
  let enqueue: jest.Mock;
  let service: IntegrationOrchestratorService;

  beforeEach(() => {
    jest.spyOn(GenerateRcofUseCase, 'yesterdaySantiago').mockReturnValue('2026-09-26');
    enqueue = jest.fn().mockResolvedValue({ replayed: false, request: { id: 'request-1' } });
    const processor = { processDue: jest.fn().mockResolvedValue({ claimed: 1, results: [] }) };
    const dataServices = {
      tenant: { getAll: () => of([tenant]) },
      dteDocument: {
        getAll: () => of([{
          type: 39,
          status: 'ENVIADO',
          xmlContent: '<DTE><Documento><FchEmis>2026-09-26</FchEmis></Documento></DTE>',
        }]),
      },
    } as any;
    const cls = { run: (_state: unknown, callback: () => unknown) => callback(), set: jest.fn() } as any;
    service = new IntegrationOrchestratorService(
      dataServices,
      cls,
      {} as any,
      processor as any,
      {} as any,
      {} as any,
      {} as any,
      { enqueue } as any,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  it('encola una solicitud durable con clave estable y sin credencial de API', async () => {
    await expect(service.rcofDaily()).resolves.toEqual({ tenantsChecked: 1, enqueued: 1, errors: [] });
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({
      tenantId,
      credentialId: null,
      kind: 'rcof',
      idempotencyKey: 'rcof-daily:2026-09-26:1',
      payload: { date: '2026-09-26', sequenceNumber: 1 },
      metadata: { source: 'rcof-daily' },
    }));
  });

  it('un replay posterior al reinicio no duplica ni vuelve a contar el RCOF diario', async () => {
    enqueue.mockResolvedValue({ replayed: true, request: { id: 'request-existing' } });
    await expect(service.rcofDaily()).resolves.toEqual({ tenantsChecked: 1, enqueued: 0, errors: [] });
    expect(enqueue).toHaveBeenCalledTimes(1);
  });
});
