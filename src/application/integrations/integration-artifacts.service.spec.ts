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

  it('reconstruye el PDF con el perfil visual fijado al DTE', async () => {
    const dteDocument = new MemoryGenericRepository<any>();
    const tenant = new MemoryGenericRepository<any>();
    const invoiceBrandProfile = new MemoryGenericRepository<any>();
    const profile = await invoiceBrandProfile.create({
      id: 'brand-1', tenantId: 'tenant-1', version: 2,
      primaryColor: '#123456', secondaryColor: '#ABCDEF', logoData: null,
    }).toPromise();
    const dte = await dteDocument.create({
      id: 'dte-1', tenantId: 'tenant-1', type: 33, folio: 10,
      brandProfileId: profile!.id, xmlContent: '<DTE />',
    }).toPromise();
    await tenant.create({ id: 'tenant-1', businessName: 'Empresa' }).toPromise();
    const pdfGenerator = { generateDtePdf: jest.fn().mockResolvedValue(Buffer.from('pdf')) };
    const service = new IntegrationArtifactsService({ dteDocument, tenant, invoiceBrandProfile } as any, pdfGenerator as any);

    const result = await service.getPdf('tenant-1', dte!.id);

    expect(result.pdf.toString()).toBe('pdf');
    expect(pdfGenerator.generateDtePdf).toHaveBeenCalledWith(dte, expect.objectContaining({ id: 'tenant-1' }), profile);
  });
});
