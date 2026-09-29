import { TenantConfigService } from './tenant-config.service';

describe('TenantConfigService — perfil visual activo', () => {
  const tenantId = 'tenant-1';
  const brandProfileId = '11111111-1111-4111-8111-111111111111';

  const createService = () => {
    const record: any = {
      tenantId,
      configJson: {
        cafs: [{ type: 33, rangeFrom: 1, rangeTo: 100, lastUsedFolio: 17 }],
      },
    };
    const repository = {
      findOne: jest.fn().mockResolvedValue(record),
      save: jest.fn().mockImplementation(async (value) => value),
      create: jest.fn().mockImplementation((value) => value),
    };
    const manager: any = {
      query: jest.fn().mockResolvedValue(undefined),
      getRepository: jest.fn().mockReturnValue(repository),
    };
    manager.transaction = jest.fn(async (operation) => operation(manager));
    const service = new TenantConfigService(
      { manager } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { get: jest.fn().mockReturnValue(undefined) } as any,
    );
    return { service, record, repository, manager };
  };

  it('fija la marca desde una fila bloqueada sin retroceder el folio y no expone referencias mutables del caché', async () => {
    const { service, record, repository } = createService();

    const cachedSnapshot = await service.getConfig(tenantId);
    cachedSnapshot.cafs[0].lastUsedFolio = 1;

    await service.setActiveBrandProfileId(tenantId, brandProfileId);

    expect(record.configJson.cafs[0].lastUsedFolio).toBe(17);
    expect(record.configJson.activeBrandProfileId).toBe(brandProfileId);
    expect(repository.findOne).toHaveBeenLastCalledWith({
      where: { tenantId },
      lock: { mode: 'pessimistic_write' },
    });
    expect(await service.getActiveBrandProfileIdForEmission(tenantId)).toBe(brandProfileId);
  });

  it('conserva el perfil activo al guardar una configuración basada en caché obsoleta', async () => {
    const { service, record, repository } = createService();

    // La petición administrativa obtiene una copia previa del caché.
    await service.getConfig(tenantId);
    // Otra petición fija la marca antes de que la primera persista su cambio.
    record.configJson.activeBrandProfileId = brandProfileId;

    await service.setAiEnabled(tenantId, true);

    expect(record.configJson.activeBrandProfileId).toBe(brandProfileId);
    expect(record.configJson.aiEnabled).toBe(true);
    expect(repository.findOne).toHaveBeenLastCalledWith({
      where: { tenantId },
      lock: { mode: 'pessimistic_write' },
    });
  });
});
