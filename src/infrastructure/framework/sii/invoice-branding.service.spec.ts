import { firstValueFrom } from 'rxjs';
import type { SharpConstructor } from 'sharp';
import { MemoryGenericRepository } from '../memory/memory-generic-repository';
import { InvoiceBrandingService } from './invoice-branding.service';
import {
  DEFAULT_INVOICE_PRIMARY_COLOR,
  DEFAULT_INVOICE_SECONDARY_COLOR,
} from './invoice-branding.defaults';

const sharp = require('sharp') as SharpConstructor;

const createLogo = (format: 'png' | 'jpeg' = 'png') => {
  const image = sharp({
    create: { width: 20, height: 12, channels: 4, background: { r: 25, g: 70, b: 140, alpha: 1 } },
  });
  return format === 'png' ? image.png().toBuffer() : image.jpeg().toBuffer();
};

describe('InvoiceBrandingService', () => {
  const tenantId = 'tenant-1';

  const createService = () => {
    const config: any = { cafs: [] };
    const invoiceBrandProfile = new MemoryGenericRepository<any>();
    const auditLog = new MemoryGenericRepository<any>();
    const tenantConfig = {
      getConfig: jest.fn().mockImplementation(async () => config),
      getActiveBrandProfileIdForEmission: jest.fn().mockImplementation(async () => config.activeBrandProfileId || null),
      setActiveBrandProfileId: jest.fn().mockImplementation(async (_tenant: string, profileId: string) => {
        config.activeBrandProfileId = profileId;
      }),
    };
    const dataServices = { invoiceBrandProfile, auditLog };
    return {
      service: new InvoiceBrandingService(dataServices as any, tenantConfig as any),
      config,
      invoiceBrandProfile,
      auditLog,
      tenantConfig,
    };
  };

  it('normaliza un JPEG a PNG, crea versión 1 y no audita el base64', async () => {
    const { service, invoiceBrandProfile, auditLog, tenantConfig } = createService();
    const jpeg = await createLogo('jpeg');
    const base64 = jpeg.toString('base64');

    const metadata = await service.update(tenantId, {
      logo: { mimeType: 'image/jpeg', base64 },
      primaryColor: '#1f4b99',
      secondaryColor: '#5b8def',
    }, 'credential-1');

    expect(metadata).toEqual(expect.objectContaining({
      configured: true,
      version: 1,
      primaryColor: '#1F4B99',
      secondaryColor: '#5B8DEF',
      logo: expect.objectContaining({ mimeType: 'image/png' }),
    }));
    expect(tenantConfig.setActiveBrandProfileId).toHaveBeenCalledWith(tenantId, expect.any(String));
    const profiles = await firstValueFrom(invoiceBrandProfile.find({ where: { tenantId } }));
    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toEqual(expect.objectContaining({
      version: 1,
      logoMimeType: 'image/png',
      primaryColor: '#1F4B99',
    }));
    expect((await sharp(profiles[0].logoData).metadata()).format).toBe('png');
    const audit = await firstValueFrom(auditLog.getAll());
    expect(JSON.stringify(audit[0].payload)).not.toContain(base64);
    expect(audit[0].payload).toEqual(expect.objectContaining({ hasLogo: true, credentialId: 'credential-1' }));
  });

  it('crea y activa un perfil neutro versionado antes de la primera personalización', async () => {
    const { service, config, invoiceBrandProfile, tenantConfig } = createService();

    const profileId = await service.ensureActiveBrandProfileIdForEmission(tenantId);

    expect(profileId).toBeTruthy();
    expect(config.activeBrandProfileId).toBe(profileId);
    expect(tenantConfig.setActiveBrandProfileId).toHaveBeenCalledWith(tenantId, profileId);
    const profiles = await firstValueFrom(invoiceBrandProfile.find({ where: { tenantId } }));
    expect(profiles).toEqual([expect.objectContaining({
      version: 1,
      logoData: null,
      primaryColor: DEFAULT_INVOICE_PRIMARY_COLOR,
      secondaryColor: DEFAULT_INVOICE_SECONDARY_COLOR,
    })]);
  });

  it('preserva la versión anterior y activa una nueva versión completa', async () => {
    const { service, config, invoiceBrandProfile } = createService();
    const png = await createLogo('png');
    await service.update(tenantId, {
      logo: { mimeType: 'image/png', base64: png.toString('base64') },
      primaryColor: '#111111',
      secondaryColor: '#222222',
    });

    const second = await service.update(tenantId, {
      logo: null,
      primaryColor: '#333333',
      secondaryColor: '#444444',
    });
    const profiles = await firstValueFrom(invoiceBrandProfile.find({ where: { tenantId } }));
    const first = profiles.find((profile) => profile.version === 1);
    const current = profiles.find((profile) => profile.version === 2);

    expect(second).toEqual(expect.objectContaining({ version: 2, logo: null }));
    expect(first).toEqual(expect.objectContaining({ primaryColor: '#111111', logoMimeType: 'image/png' }));
    expect(current).toEqual(expect.objectContaining({ primaryColor: '#333333', logoData: null }));
    expect(config.activeBrandProfileId).toBe(current.id);
  });

  it('rechaza contenido que no corresponde al MIME declarado', async () => {
    const { service } = createService();
    const png = await createLogo('png');

    await expect(service.update(tenantId, {
      logo: { mimeType: 'image/jpeg', base64: png.toString('base64') },
      primaryColor: '#111111',
      secondaryColor: '#222222',
    })).rejects.toThrow('MIME declarado no coincide');
  });

  it('rechaza una carga base64 que supera el máximo antes de decodificarla', async () => {
    const { service } = createService();

    await expect(service.update(tenantId, {
      logo: { mimeType: 'image/png', base64: 'A'.repeat(955740) },
      primaryColor: '#111111',
      secondaryColor: '#222222',
    })).rejects.toThrow('base64 estándar');
  });

  it('rechaza un color principal que dejaría texto blanco ilegible en el PDF', async () => {
    const { service } = createService();

    await expect(service.update(tenantId, {
      logo: null,
      primaryColor: '#FFFFFF',
      secondaryColor: '#5B8DEF',
    })).rejects.toThrow('contraste suficiente');
  });
});
