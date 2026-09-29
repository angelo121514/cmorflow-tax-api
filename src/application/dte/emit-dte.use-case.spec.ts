import { firstValueFrom, of } from 'rxjs';
import { EmitDteUseCase } from './emit-dte.use-case';

describe('EmitDteUseCase — snapshot de marca', () => {
  const tenantId = 'tenant-1';

  const createUseCase = (activeBrandProfileId?: unknown) => {
    const dteDocument = {
      create: jest.fn((document) => of({ ...document, id: 'dte-1' })),
    };
    const tenantConfigService = {
      requireTaxProfileForRealEmission: jest.fn().mockResolvedValue({
        giro: 'Servicios de prueba',
        activities: ['620100'],
        address: 'Av. Prueba 100',
        commune: 'Santiago',
        city: 'Santiago',
      }),
      getDecryptedCafForFolio: jest.fn().mockResolvedValue({
        cafXml: '<AUTORIZACION />',
        cafPrivateKey: {},
      }),
      getDecryptedSignature: jest.fn().mockResolvedValue({
        pfxBase64: 'certificate',
        passwordString: 'password',
      }),
      getActiveBrandProfileIdForEmission: jest.fn().mockResolvedValue(
        typeof activeBrandProfileId === 'string' && activeBrandProfileId.trim()
          ? activeBrandProfileId.trim()
          : null,
      ),
    };
    const invoiceBrandingService = {
      ensureActiveBrandProfileIdForEmission: jest.fn().mockResolvedValue(
        typeof activeBrandProfileId === 'string' && activeBrandProfileId.trim()
          ? activeBrandProfileId.trim()
          : '00000000-0000-4000-8000-000000000001',
      ),
    };
    const signatureEngine = {
      signXml: jest.fn().mockReturnValue({
        signedXml: '<DTE><Documento /></DTE>',
        signatureValue: 'signature-value',
      }),
    };

    const useCase = new EmitDteUseCase(
      {
        tenant: {
          get: jest.fn().mockReturnValue(of({
            id: tenantId,
            rut: '76123456-7',
            businessName: 'Empresa de Prueba SpA',
          })),
        },
        dteDocument,
      } as any,
      signatureEngine as any,
      { reserveFolioAtomic: jest.fn().mockResolvedValue(42) } as any,
      {} as any,
      {} as any,
      {
        buildDte: jest.fn().mockReturnValue({
          xml: '<DTE><Documento /></DTE>',
          totals: { totalAmount: 1190 },
        }),
      } as any,
      tenantConfigService as any,
      invoiceBrandingService as any,
    );

    return { useCase, dteDocument, tenantConfigService, invoiceBrandingService, signatureEngine };
  };

  const dto = {
    type: 33,
    receiverRut: '60803000-K',
    receiverName: 'Cliente de Prueba',
    items: [{ name: 'Servicio', quantity: 1, price: 1000 }],
  };

  it('persiste el perfil de marca activo junto al DTE firmado', async () => {
    const { useCase, dteDocument, invoiceBrandingService, signatureEngine } = createUseCase('brand-profile-v2');

    const saved = await firstValueFrom(useCase.prepare(dto, tenantId));

    expect((saved as any).brandProfileId).toBe('brand-profile-v2');
    expect(dteDocument.create).toHaveBeenCalledWith(
      expect.objectContaining({ brandProfileId: 'brand-profile-v2', status: 'FIRMADO' }),
    );
    expect(invoiceBrandingService.ensureActiveBrandProfileIdForEmission).toHaveBeenCalledWith(tenantId);
    expect(invoiceBrandingService.ensureActiveBrandProfileIdForEmission.mock.invocationCallOrder[0]).toBeGreaterThan(
      signatureEngine.signXml.mock.invocationCallOrder[0],
    );
  });

  it('fija el perfil neutro versionado cuando aún no hay una marca personalizada', async () => {
    const { useCase, dteDocument } = createUseCase();

    const saved = await firstValueFrom(useCase.prepare(dto, tenantId));

    expect((saved as any).brandProfileId).toBe('00000000-0000-4000-8000-000000000001');
    expect(dteDocument.create).toHaveBeenCalledWith(
      expect.objectContaining({ brandProfileId: '00000000-0000-4000-8000-000000000001' }),
    );
  });
});
