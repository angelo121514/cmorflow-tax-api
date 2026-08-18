// backend/src/application/integrations/generate-rcof.use-case.spec.ts
import { GenerateRcofUseCase } from './generate-rcof.use-case';
import { MemoryGenericRepository } from '../../infrastructure/framework/memory/memory-generic-repository';
import { of } from 'rxjs';

describe('GenerateRcofUseCase — consolidación, persistencia y transmisión', () => {
  const tenantId = 'rcof-tenant-1';
  const date = '2026-08-14';
  let dataServices: any;
  let useCase: GenerateRcofUseCase;
  let soapClient: any;
  let tokenService: any;

  const boletaXml = (folio: number, total: number) =>
    `<DTE><Documento><FchEmis>${date}</FchEmis><Folio>${folio}</Folio>` +
    `<MntNeto>${Math.round(total / 1.19)}</MntNeto><IVA>${Math.round(total - total / 1.19)}</IVA>` +
    `<MntExe>0</MntExe><MntTotal>${total}</MntTotal></Documento></DTE>`;

  const seedBoletas = async () => {
    for (const [folio, total, status] of [
      [101, 1190, 'ENVIADO'],
      [102, 2380, 'ACEPTADO'],
      [103, 0, 'ANULADO'],
    ] as Array<[number, number, string]>) {
      await dataServices.dteDocument
        .create({
          tenantId,
          type: 39,
          folio,
          status,
          amount: total,
          xmlContent: boletaXml(folio, total),
        } as any)
        .toPromise();
    }
  };

  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    dataServices = {
      tenant: new MemoryGenericRepository<any>(),
      dteDocument: new MemoryGenericRepository<any>(),
      rcofSubmission: new MemoryGenericRepository<any>(),
    };
    dataServices.tenant
      .create({ id: tenantId, rut: '76123456-7', businessName: 'Test SpA' } as any)
      .toPromise();

    const dteXmlEngine: any = {
      buildRcof: jest.fn((input: any) =>
        `<ConsumoFolio><FchInicio>${input.startDate}</FchInicio><Secuencia>${input.sequenceNumber}</Secuencia></ConsumoFolio>`,
      ),
      buildEnvioBoleta: jest.fn(() => '<EnvioBOLETA></EnvioBOLETA>'),
    };
    const signatureEngine: any = {
      signXml: jest.fn((xml: string) => ({ signedXml: xml + '<SIG/>', signatureValue: 'sig' })),
    };
    soapClient = {
      sendDteEnvelope: jest.fn().mockReturnValue(of({ trackId: 'TRACK-RCOF-1' })),
      queryTrackStatus: jest.fn().mockReturnValue(of({ status: 'PROCESANDO' })),
    };
    tokenService = { getToken: jest.fn().mockResolvedValue('token-sii') };
    const tenantConfigService: any = {
      getDecryptedSignature: jest.fn().mockResolvedValue(null),
      requireTaxProfileForRealEmission: jest.fn().mockResolvedValue(null),
      getConfig: jest.fn().mockResolvedValue(null),
    };

    useCase = new GenerateRcofUseCase(
      dataServices,
      dteXmlEngine,
      signatureEngine,
      soapClient,
      tokenService,
      tenantConfigService,
    );
  });

  it('yesterdaySantiago devuelve la fecha del día anterior en Chile', () => {
    // 2026-08-15 12:00 UTC = 08:00 en Santiago (UTC-4 en agosto).
    const result = GenerateRcofUseCase.yesterdaySantiago(new Date('2026-08-15T12:00:00Z'));
    expect(result).toBe('2026-08-14');
  });

  it('consolida boletas 39/41 del día (incluye folios anulados), firma, persiste y transmite', async () => {
    await seedBoletas();
    const rcof = await useCase.execute(tenantId, { date });

    expect(rcof.status).toBe('submitted');
    expect(rcof.trackId).toBe('TRACK-RCOF-1');
    expect(rcof.periodDate).toBe(date);
    expect(rcof.xmlContent).toContain('<ConsumoFolio>');
    expect(soapClient.sendDteEnvelope).toHaveBeenCalledTimes(1);

    // La consolidación del resumen refleja 3 emitidos / 1 anulado / 2 utilizados.
    const signedArg = (useCase as any)['dteXmlEngine'].buildRcof.mock.calls[0][0];
    expect(signedArg.summaries).toHaveLength(1);
    expect(signedArg.summaries[0]).toMatchObject({
      type: 39,
      foliosEmitidos: 3,
      foliosAnulados: 1,
      foliosUtilizados: 2,
    });
  });

  it('idempotente por (tenant, fecha, secuencia): no retransmite ni duplica', async () => {
    await seedBoletas();
    const first = await useCase.execute(tenantId, { date });
    const second = await useCase.execute(tenantId, { date });
    expect(second.id).toBe(first.id);
    expect(soapClient.sendDteEnvelope).toHaveBeenCalledTimes(1);
    const all = await dataServices.rcofSubmission.getAll().toPromise();
    expect(all).toHaveLength(1);
  });

  it('secuencia distinta genera un nuevo RCOF (reenvío corregido)', async () => {
    await seedBoletas();
    const first = await useCase.execute(tenantId, { date, sequenceNumber: 1 });
    const second = await useCase.execute(tenantId, { date, sequenceNumber: 2 });
    expect(second.id).not.toBe(first.id);
    expect(second.sequence).toBe(2);
  });

  it('sin boletas ese día → 422 de validación', async () => {
    await expect(useCase.execute(tenantId, { date: '2026-01-01' })).rejects.toMatchObject({
      response: { error: { code: 'VALIDATION_ERROR' } },
    });
  });

  it('pollStatus mapea ACEPTADO del SII a accepted', async () => {
    await seedBoletas();
    const rcof = await useCase.execute(tenantId, { date });
    soapClient.queryTrackStatus.mockReturnValue(of({ status: 'ACEPTADO' }));
    const updated = await useCase.pollStatus(tenantId, rcof);
    expect(updated.status).toBe('accepted');
  });

  it('fecha inválida → 422', async () => {
    await expect(useCase.execute(tenantId, { date: '14-08-2026' } as any)).rejects.toMatchObject({
      response: { error: { code: 'VALIDATION_ERROR' } },
    });
  });
});
