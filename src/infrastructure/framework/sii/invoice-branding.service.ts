import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { firstValueFrom } from 'rxjs';
import type { Metadata, SharpConstructor } from 'sharp';
import { AuditLogEntity, IDataServices, InvoiceBrandProfileEntity } from '@domain';
import { TenantConfigService } from './tenant-config.service';
import {
  DEFAULT_INVOICE_PRIMARY_COLOR,
  DEFAULT_INVOICE_SECONDARY_COLOR,
} from './invoice-branding.defaults';

// La aplicación compila CommonJS y Sharp distribuye tipos duales CJS/ESM.
// Cargarlo así conserva la exportación invocable real de CommonJS.
const sharp = require('sharp') as SharpConstructor;

const MAX_LOGO_INPUT_BYTES = 700 * 1024;
const MAX_LOGO_OUTPUT_BYTES = 512 * 1024;
const MAX_LOGO_PIXELS = 4_000_000;
const MAX_LOGO_BASE64_LENGTH = 4 * Math.ceil(MAX_LOGO_INPUT_BYTES / 3);
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export interface BrandLogoInput {
  mimeType: 'image/png' | 'image/jpeg';
  base64: string;
}

export interface UpdateInvoiceBrandingInput {
  /** Debe estar presente; null significa una versión sin logotipo. */
  logo: BrandLogoInput | null;
  primaryColor: string;
  secondaryColor: string;
}

export interface InvoiceBrandingMetadata {
  configured: boolean;
  version: number | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  logo: { mimeType: 'image/png'; sha256: string; bytes: number } | null;
  createdAt: string | null;
}

interface NormalizedLogo {
  data: Buffer;
  mimeType: 'image/png';
  sha256: string;
}

/**
 * Administra sólo identidad visual. Cada PUT crea una versión nueva; nunca
 * edita un perfil que ya pudo ser asociado a un DTE firmado.
 */
@Injectable()
export class InvoiceBrandingService {
  private readonly logger = new Logger(InvoiceBrandingService.name);

  constructor(
    private readonly dataServices: IDataServices,
    private readonly tenantConfig: TenantConfigService,
  ) {}

  async getActiveBranding(tenantId: string): Promise<InvoiceBrandingMetadata> {
    const profile = await this.findActiveProfile(tenantId);
    return profile ? this.toMetadata(profile) : this.emptyMetadata();
  }

  async getActiveLogo(tenantId: string): Promise<{ data: Buffer; mimeType: 'image/png' } | null> {
    const profile = await this.findActiveProfile(tenantId);
    if (!profile?.logoData) return null;
    // Todo logo persistido por este servicio se normaliza a PNG. Comprobar el
    // MIME también evita que datos heredados inconsistentes se sirvan como imagen.
    if (profile.logoMimeType !== 'image/png') {
      throw new NotFoundException('El logo configurado no está disponible en un formato válido.');
    }
    return { data: Buffer.from(profile.logoData), mimeType: 'image/png' };
  }

  /**
   * Obtiene el perfil que debe quedar fijado en una emisión. Los DTE nuevos
   * siempre llevan una versión, incluso antes de que el administrador cargue
   * un logo: así el diseño neutro también queda congelado en el documento.
   * Los DTE históricos sin referencia siguen siendo legibles con el fallback
   * neutro del generador.
   */
  async ensureActiveBrandProfileIdForEmission(tenantId: string): Promise<string> {
    const activeId = await this.tenantConfig.getActiveBrandProfileIdForEmission(tenantId);
    if (activeId) return activeId;

    const existing = await firstValueFrom(
      this.dataServices.invoiceBrandProfile.find({ where: { tenantId } }),
    );
    let profile = [...existing].sort((left, right) => (right.version || 0) - (left.version || 0))[0];
    if (!profile) {
      profile = await this.createNextVersion(tenantId, {
        logoData: null,
        logoMimeType: null,
        logoSha256: null,
        primaryColor: DEFAULT_INVOICE_PRIMARY_COLOR,
        secondaryColor: DEFAULT_INVOICE_SECONDARY_COLOR,
        createdByCredentialId: null,
      });
    }
    if (!profile.id) {
      throw new Error('No se pudo fijar el perfil visual base para la emisión del DTE.');
    }
    await this.tenantConfig.setActiveBrandProfileId(tenantId, profile.id);
    return profile.id;
  }

  async update(
    tenantId: string,
    input: UpdateInvoiceBrandingInput,
    createdByCredentialId?: string,
  ): Promise<InvoiceBrandingMetadata> {
    if (!Object.prototype.hasOwnProperty.call(input, 'logo')) {
      throw new BadRequestException('logo es obligatorio; use null para emitir una versión sin logotipo.');
    }
    const primaryColor = this.normalizeColor(input.primaryColor, 'primaryColor');
    const secondaryColor = this.normalizeColor(input.secondaryColor, 'secondaryColor');
    const logo = input.logo === null ? null : await this.normalizeLogo(input.logo);

    const profile = await this.createNextVersion(tenantId, {
      logoData: logo?.data ?? null,
      logoMimeType: logo?.mimeType ?? null,
      logoSha256: logo?.sha256 ?? null,
      primaryColor,
      secondaryColor,
      createdByCredentialId: createdByCredentialId || null,
    });

    await this.tenantConfig.setActiveBrandProfileId(tenantId, profile.id!);
    await this.audit(tenantId, 'INVOICE_BRANDING_UPDATED', {
      brandProfileId: profile.id,
      version: profile.version,
      hasLogo: !!profile.logoData,
      logoSha256: profile.logoSha256,
      primaryColor: profile.primaryColor,
      secondaryColor: profile.secondaryColor,
      ...(createdByCredentialId ? { credentialId: createdByCredentialId } : {}),
    });
    this.logger.log(`Perfil visual v${profile.version} activado para tenant ${tenantId}.`);
    return this.toMetadata(profile);
  }

  private async findActiveProfile(tenantId: string): Promise<InvoiceBrandProfileEntity | null> {
    // La lectura administrativa también evita el TTL local: distintas
    // instancias web/worker deben observar inmediatamente la versión activa.
    const activeBrandProfileId = await this.tenantConfig.getActiveBrandProfileIdForEmission(tenantId);
    if (!activeBrandProfileId) return null;
    const profile = await firstValueFrom(
      this.dataServices.invoiceBrandProfile.get(activeBrandProfileId),
    );
    if (!profile) {
      throw new NotFoundException('El perfil visual activo no está disponible para esta empresa.');
    }
    return profile;
  }

  private async createNextVersion(
    tenantId: string,
    value: Omit<InvoiceBrandProfileEntity, 'id' | 'tenantId' | 'version' | 'createdAt'>,
  ): Promise<InvoiceBrandProfileEntity> {
    // La restricción única de la base de datos es la autoridad ante dos cambios
    // concurrentes. Recalculamos la versión una vez si otro administrador gana
    // la carrera antes de la inserción.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const existing = await firstValueFrom(
        this.dataServices.invoiceBrandProfile.find({ where: { tenantId } }),
      );
      const version = existing.reduce((highest, profile) => Math.max(highest, profile.version || 0), 0) + 1;
      try {
        const created = await firstValueFrom(
          this.dataServices.invoiceBrandProfile.create({ tenantId, version, ...value }),
        );
        if (!created.id) throw new Error('La base de datos no devolvió el identificador del perfil visual creado.');
        return created;
      } catch (error) {
        if (attempt < 2 && this.isVersionConflict(error)) continue;
        throw error;
      }
    }
    throw new Error('No se pudo reservar una versión de perfil visual.');
  }

  private async normalizeLogo(input: BrandLogoInput): Promise<NormalizedLogo> {
    if (!input || (input.mimeType !== 'image/png' && input.mimeType !== 'image/jpeg')) {
      throw new BadRequestException('El logo debe declarar mimeType image/png o image/jpeg.');
    }
    const raw = this.decodeBase64(input.base64);
    if (raw.length === 0 || raw.length > MAX_LOGO_INPUT_BYTES) {
      throw new BadRequestException(`El logo debe pesar entre 1 byte y ${Math.floor(MAX_LOGO_INPUT_BYTES / 1024)} KB.`);
    }

    let metadata: Metadata;
    try {
      metadata = await sharp(raw, { limitInputPixels: MAX_LOGO_PIXELS, animated: false }).metadata();
    } catch {
      throw new BadRequestException('El contenido del logo no corresponde a una imagen PNG o JPEG válida.');
    }
    const detectedMime = metadata.format === 'png'
      ? 'image/png'
      : metadata.format === 'jpeg'
        ? 'image/jpeg'
        : null;
    if (!detectedMime || detectedMime !== input.mimeType || !metadata.width || !metadata.height) {
      throw new BadRequestException('El MIME declarado no coincide con el contenido PNG/JPEG del logo.');
    }
    if ((metadata.pages || 1) > 1) {
      throw new BadRequestException('El logo debe ser una imagen estática de una sola página.');
    }

    let data: Buffer;
    try {
      // rotate aplica orientación EXIF y la salida PNG, sin withMetadata(),
      // elimina metadatos de origen antes de guardar el activo tributario.
      data = await sharp(raw, { limitInputPixels: MAX_LOGO_PIXELS, animated: false })
        .rotate()
        .resize({ width: 1200, height: 400, fit: 'inside', withoutEnlargement: true })
        .png({ compressionLevel: 9, adaptiveFiltering: true })
        .toBuffer();
    } catch {
      throw new BadRequestException('No se pudo normalizar el logo de la empresa.');
    }
    if (data.length > MAX_LOGO_OUTPUT_BYTES) {
      throw new BadRequestException(`El logo normalizado supera ${Math.floor(MAX_LOGO_OUTPUT_BYTES / 1024)} KB.`);
    }
    return {
      data,
      mimeType: 'image/png',
      sha256: createHash('sha256').update(data).digest('hex'),
    };
  }

  private decodeBase64(value: string): Buffer {
    const base64 = typeof value === 'string' ? value.trim() : '';
    if (
      !base64 ||
      base64.length > MAX_LOGO_BASE64_LENGTH ||
      base64.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)
    ) {
      throw new BadRequestException('logo.base64 debe estar codificado en base64 estándar sin prefijo data:.');
    }
    const decoded = Buffer.from(base64, 'base64');
    if (decoded.toString('base64') !== base64) {
      throw new BadRequestException('logo.base64 no es una codificación base64 válida.');
    }
    return decoded;
  }

  private normalizeColor(value: string, field: string): string {
    if (typeof value !== 'string' || !HEX_COLOR.test(value.trim())) {
      throw new BadRequestException(`${field} debe usar el formato hexadecimal #RRGGBB.`);
    }
    const color = value.trim().toUpperCase();
    // El color principal se usa sobre fondos con texto blanco en tablas. Un
    // mínimo AA evita que una personalización deje los importes ilegibles.
    if (field === 'primaryColor' && this.contrastRatio(color, '#FFFFFF') < 4.5) {
      throw new BadRequestException('primaryColor debe tener contraste suficiente con texto blanco para imprimir la factura.');
    }
    return color;
  }

  private contrastRatio(first: string, second: string): number {
    const luminance = (color: string): number => {
      const components = [1, 3, 5].map((start) => Number.parseInt(color.slice(start, start + 2), 16) / 255);
      const linear = components.map((component) => (
        component <= 0.03928 ? component / 12.92 : ((component + 0.055) / 1.055) ** 2.4
      ));
      return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
    };
    const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);
    return (lighter + 0.05) / (darker + 0.05);
  }

  private toMetadata(profile: InvoiceBrandProfileEntity): InvoiceBrandingMetadata {
    return {
      configured: true,
      version: profile.version,
      primaryColor: profile.primaryColor,
      secondaryColor: profile.secondaryColor,
      logo: profile.logoData && profile.logoSha256
        ? { mimeType: 'image/png', sha256: profile.logoSha256, bytes: profile.logoData.length }
        : null,
      createdAt: profile.createdAt ? new Date(profile.createdAt).toISOString() : null,
    };
  }

  private emptyMetadata(): InvoiceBrandingMetadata {
    return {
      configured: false,
      version: null,
      primaryColor: null,
      secondaryColor: null,
      logo: null,
      createdAt: null,
    };
  }

  private isVersionConflict(error: unknown): boolean {
    const candidate = error as { code?: string; message?: string };
    return candidate?.code === '23505' || /unique|duplicate/i.test(candidate?.message || '');
  }

  private async audit(tenantId: string, action: string, payload: Record<string, unknown>): Promise<void> {
    const log = new AuditLogEntity();
    log.tenantId = tenantId;
    log.action = action;
    log.payload = payload;
    await firstValueFrom(this.dataServices.auditLog.create(log)).catch((error) =>
      this.logger.warn(`No se pudo registrar auditoría ${action}: ${(error as Error).message}`),
    );
  }
}
