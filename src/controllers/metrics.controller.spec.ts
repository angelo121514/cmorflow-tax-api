import { MetricsController } from './metrics.controller';

describe('MetricsController', () => {
  const original = process.env;
  afterEach(() => { process.env = original; });

  it('requires a constant-time bearer secret in production', async () => {
    process.env = { ...original, NODE_ENV: 'production', METRICS_ENABLED: 'true', METRICS_BEARER_TOKEN: 'x'.repeat(32) };
    const controller = new MetricsController({ getMetrics: async () => 'metrics' } as any);
    await expect(controller.getMetrics()).rejects.toThrow();
    await expect(controller.getMetrics(`Bearer ${'x'.repeat(32)}`)).resolves.toBe('metrics');
  });
});
