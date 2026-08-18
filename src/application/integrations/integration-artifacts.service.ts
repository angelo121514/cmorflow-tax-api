// backend/src/application/integrations/integration-artifacts.service.ts
import { Injectable } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import { IDataServices } from '@domain';
import { PdfGenerator } from '../../infrastructure/framework/sii/pdf.generator';
import { IntegrationSignatureUtil } from '../../infrastructure/framework/integrations/integration-signature.util';
import { IntegrationApiException } from './integration-api.exception';
import { IntegrationErrorCode } from './integration-errors';

/** Duración por defecto de una URL firmada de artefacto. */
const URL_TTL_SECONDS = 300;

export interface SignedArtifact {
  dteId: string;
  kind: 'xml' | 'pdf';
  tenantId: string;
  exp: number;
}

/**
 * Entrega privada de artefactos (XML/PDF): descarga autenticada directa o
 * URL firmada de corta duración. Nunca buckets públicos.
 *
 * Token: base64url(JSON payload).hex32(HMAC) — verificado en el endpoint
 * público /integrations/artifacts/:token.
 */
@Injectable()
export class IntegrationArtifactsService {
  constructor(
    private readonly dataServices: IDataServices,
    private readonly pdfGenerator: PdfGenerator,
  ) {}

  private get urlSecret(): string {
    return process.env.INTEGRATION_URL_SECRET || process.env.JWT_SECRET || 'dev-insecure-url-secret';
  }

  async createSignedUrl(
    tenantId: string,
    dteId: string,
    kind: 'xml' | 'pdf',
  ): Promise<{ url: string; expiresAt: string }> {
    // Verificar tenencia antes de emitir el enlace.
    const dte = await firstValueFrom(this.dataServices.dteDocument.get(dteId));
    if (!dte || dte.tenantId !== tenantId) {
      throw new IntegrationApiException(
        IntegrationErrorCode.NOT_FOUND,
        'DTE no encontrado para esta credencial.',
        404,
      );
    }
    const payload: SignedArtifact = {
      dteId,
      kind,
      tenantId,
      exp: Math.floor(Date.now() / 1000) + URL_TTL_SECONDS,
    };
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = IntegrationSignatureUtil.signUrlToken(this.urlSecret, body);
    return {
      url: `/api/v1/integrations/artifacts/${body}.${sig}`,
      expiresAt: new Date(payload.exp * 1000).toISOString(),
    };
  }

  verifySignedUrl(token: string): SignedArtifact {
    const dot = token.lastIndexOf('.');
    if (dot <= 0) {
      throw new IntegrationApiException(IntegrationErrorCode.NOT_FOUND, 'Token inválido.', 404);
    }
    const body = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const expected = IntegrationSignatureUtil.signUrlToken(this.urlSecret, body);
    if (sig !== expected) {
      throw new IntegrationApiException(IntegrationErrorCode.NOT_FOUND, 'Token inválido.', 404);
    }
    let payload: SignedArtifact;
    try {
      payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf-8'));
    } catch {
      throw new IntegrationApiException(IntegrationErrorCode.NOT_FOUND, 'Token inválido.', 404);
    }
    if (payload.exp * 1000 <= Date.now()) {
      throw new IntegrationApiException(
        IntegrationErrorCode.NOT_FOUND,
        'El enlace firmado ha expirado.',
        404,
      );
    }
    return payload;
  }

  async getXml(tenantId: string, dteId: string): Promise<{ dte: any; xml: string }> {
    const dte = await firstValueFrom(this.dataServices.dteDocument.get(dteId));
    if (!dte || dte.tenantId !== tenantId) {
      throw new IntegrationApiException(
        IntegrationErrorCode.NOT_FOUND,
        'DTE no encontrado para esta credencial.',
        404,
      );
    }
    return { dte, xml: dte.xmlContent };
  }

  async getPdf(tenantId: string, dteId: string): Promise<{ dte: any; pdf: Buffer }> {
    const dte = await firstValueFrom(this.dataServices.dteDocument.get(dteId));
    if (!dte || dte.tenantId !== tenantId) {
      throw new IntegrationApiException(
        IntegrationErrorCode.NOT_FOUND,
        'DTE no encontrado para esta credencial.',
        404,
      );
    }
    const tenant = await firstValueFrom(this.dataServices.tenant.get(tenantId));
    const pdf = await this.pdfGenerator.generateDtePdf(dte, tenant);
    return { dte, pdf };
  }
}
