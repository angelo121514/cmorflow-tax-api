import { IntegrationOrchestratorService } from './integration-orchestrator.service';

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
    );

    await expect((service as any).purgeNonces()).resolves.toBe(7);
  });
});
