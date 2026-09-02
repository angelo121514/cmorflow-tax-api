import { IntegrationArtifactsService } from './integration-artifacts.service';
import { MemoryGenericRepository } from '../../infrastructure/framework/memory/memory-generic-repository';

describe('IntegrationArtifactsService', () => {
  beforeEach(() => { process.env.INTEGRATION_URL_SECRET = 'artifact-test-secret-longer-than-32'; });

  it('generates the real public route and rejects a modified token', async () => {
    const dteDocument = new MemoryGenericRepository<any>();
    const dte = await dteDocument.create({ id: 'dte-1', tenantId: 'tenant-1', type: 33 }).toPromise();
    const service = new IntegrationArtifactsService({ dteDocument } as any, {} as any);
    const signed = await service.createSignedUrl('tenant-1', dte!.id, 'xml');
    expect(signed.url).toMatch(/^\/api\/v1\/artifacts\//);
    const token = signed.url.split('/').pop()!;
    expect(service.verifySignedUrl(token).dteId).toBe(dte!.id);
    try {
      service.verifySignedUrl(token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a'));
      throw new Error('expected verification failure');
    } catch (error: any) {
      expect(error.getStatus()).toBe(404);
      expect(error.getResponse().error.message).toBe('Token inválido.');
    }
  });
});
