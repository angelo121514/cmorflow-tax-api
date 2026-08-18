import { Injectable, Logger } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import { SignatureEngine } from './signature.engine';
import { SiiSoapClient } from './sii-soap.client';

interface CachedToken {
  token: string;
  expiresAt: number;
}

export interface SiiCertificateMaterial {
  pfxBase64: string;
  password: string;
}

@Injectable()
export class SiiAuthTokenService {
  private readonly logger = new Logger(SiiAuthTokenService.name);
  private readonly cache = new Map<string, CachedToken>();
  // ISSUE-013: el token del SII expira a ~2h, no 11h. El TTL previo (11h)
  // hacía que el cache sirviera tokens ya expirados, fallando todas las
  // emisiones posteriores. Dejamos un margen de seguridad (renueva a 110 min).
  private readonly tokenTtlMs = 110 * 60 * 1000;

  constructor(
    private readonly siiSoapClient: SiiSoapClient,
    private readonly signatureEngine: SignatureEngine,
  ) {}

  async getToken(cacheKey: string, certificate: SiiCertificateMaterial): Promise<string> {
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.token;
    }

    return this.renewToken(cacheKey, certificate);
  }

  async renewToken(cacheKey: string, certificate: SiiCertificateMaterial): Promise<string> {
    this.logger.log(`Renovando token SII para ${cacheKey}.`);
    const seed = await firstValueFrom(this.siiSoapClient.getSeed());
    const rawSeedXml = `<?xml version="1.0" encoding="ISO-8859-1"?><Documento ID="Semilla"><Semilla>${seed}</Semilla></Documento>`;
    const { signedXml } = this.signatureEngine.signXml(
      rawSeedXml,
      certificate.pfxBase64,
      certificate.password,
      'Semilla',
    );
    const token = await firstValueFrom(this.siiSoapClient.getToken(signedXml));

    this.cache.set(cacheKey, {
      token,
      expiresAt: Date.now() + this.tokenTtlMs,
    });

    return token;
  }

  invalidate(cacheKey: string): void {
    this.cache.delete(cacheKey);
  }
}
