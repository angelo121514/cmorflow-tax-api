import { IntegrationQueueClaimer } from './integration-queue.claimer';

describe('IntegrationQueueClaimer SQL contract', () => {
  it('returns camelCase rows and does not count a claim as a failed attempt', async () => {
    const queries: string[] = [];
    const row = { id: 'request-1', tenantId: 'tenant-1', originCredentialId: 'credential-1', attempts: 0 };
    const manager = { query: jest.fn(async (sql: string) => {
      queries.push(sql);
      return sql.includes('UPDATE integration_requests') ? [[row], 1] : [];
    }) };
    const dataSource = { transaction: (callback: any) => callback(manager) } as any;
    const claimer = new IntegrationQueueClaimer(dataSource, {} as any, {} as any);

    await expect(claimer.claimDue(5)).resolves.toEqual([row]);
    const update = queries.find((sql) => sql.includes('UPDATE integration_requests'))!;
    expect(update).toContain('tenant_id AS "tenantId"');
    expect(update).toContain('WITH candidates AS MATERIALIZED');
    expect(update).not.toContain('attempts = attempts + 1');
  });
});
