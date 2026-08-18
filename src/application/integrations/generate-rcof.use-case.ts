// backend/src/application/integrations/generate-rcof.use-case.ts
import { Injectable, Logger } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import { IDataServices, RcofSubmissionEntity } from '@domain';
import { DteXmlEngine } from '../../infrastructure/framework/sii/dte-xml.engine';
import { SignatureEngine } from '../../infrastructure/framework/sii/signature.engine';
import { SiiSoapClient } from '../../infrastructure/framework/sii/sii-soap.client';
import { SiiAuthTokenService } from '../../infrastructure/framework/sii/sii-auth-token.service';
import { TenantConfigService } from '../../infrastructure/framework/sii/tenant-config.service';
import { CertificateUtils } from '../../infrastructure/framework/sii/certificate.utils';
import { IntegrationApiException } from './integration-api.exception';
import { IntegrationErrorCode } from './integration-errors';

/**
 * Ciclo completo del RCOF: consolidar boletas 39/41 del día (con folios
 * anulados), firmar, PERSISTIR (idempotente por tenant+fecha+secuencia) y
 * TRANSMITIR al SII dentro de un sobre EnvioBOLETA, conservando TrackID.
 *
 * Extrae y centraliza la lógica que vivía inline en DteController para que
 * tanto la fachada interna como la B2B usen el mismo flujo.
 */
@Injectable()
export class GenerateRcofUseCase {
  private readonly logger = new Logger(GenerateRcofUseCase.name);

  constructor(
    private readonly dataServices: IDataServices,
    private readonly dteXmlEngine: DteXmlEngine,
    private readonly signatureEngine: SignatureEngine,
    private readonly siiSoapClient: SiiSoapClient,
    private readonly siiAuthTokenService: SiiAuthTokenService,
    private readonly tenantConfigService: TenantConfigService,
  ) {}

  /** Fecha de "ayer" en zona horaria de Chile (America/Santiago). */
  static yesterdaySantiago(now: Date = new Date()): string {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Santiago',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const today = fmt.format(now);
    const d = new Date(today + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  }

  /**
   * Genera (o devuelve si ya existe) el RCOF de la fecha. `sequenceNumber`
   * por defecto 1 — el SII permite reenvíos corregidos con secuencia mayor.
   */
  async execute(
    tenantId: string,
    input: { date: string; sequenceNumber?: number },
  ): Promise<RcofSubmissionEntity> {
    const sequence = input.sequenceNumber ?? 1;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
      throw new IntegrationApiException(
        IntegrationErrorCode.VALIDATION_ERROR,
        'date debe tener formato YYYY-MM-DD.',
        422,
      );
    }

    // Idempotencia por (tenant, fecha, secuencia).
    const existing = await firstValueFrom(
      this.dataServices.rcofSubmission.findOne({
        where: { tenantId, periodDate: input.date, sequence },
      }),
    );
    if (existing) {
      return existing;
    }

    const summaries = await this.consolidateDay(tenantId, input.date);
    if (summaries.length === 0) {
      throw new IntegrationApiException(
        IntegrationErrorCode.VALIDATION_ERROR,
        `No existen boletas 39/41 emitidas el ${input.date} para generar el RCOF.`,
        422,
      );
    }

    const signedXml = await this.buildAndSign(tenantId, input.date, sequence, summaries);

    // Persistir ANTES de transmitir: la transmisión es recuperable.
    const rcof = await firstValueFrom(
      this.dataServices.rcofSubmission.create({
        tenantId,
        periodDate: input.date,
        sequence,
        xmlContent: signedXml,
        status: 'submitted' as const,
        siiResponse: null,
      } as any),
    );

    return this.transmit(tenantId, rcof);
  }

  /** Reintentar la transmisión de un RCOF persistido (reconciler). */
  async transmit(tenantId: string, rcof: RcofSubmissionEntity): Promise<RcofSubmissionEntity> {
    try {
      const { envelopeXml, token } = await this.buildEnvelope(tenantId, rcof.xmlContent);
      const result = await firstValueFrom(this.siiSoapClient.sendDteEnvelope(envelopeXml, token));
      const updated = await firstValueFrom(
        this.dataServices.rcofSubmission.update(rcof.id!, {
          trackId: result.trackId,
          status: 'submitted',
          siiResponse: { trackId: result.trackId, sentAt: new Date().toISOString() },
        } as any),
      );
      this.logger.log(`RCOF ${rcof.id} transmitido. TrackID: ${result.trackId}`);
      return updated!;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await firstValueFrom(
        this.dataServices.rcofSubmission.update(rcof.id!, {
          status: 'failed',
          siiResponse: { error: message, failedAt: new Date().toISOString() },
        } as any),
      );
      this.logger.error(`Transmisión de RCOF ${rcof.id} falló: ${message}`);
      throw err;
    }
  }

  /** Consulta el TrackID del RCOF al SII y consolida su estado. */
  async pollStatus(tenantId: string, rcof: RcofSubmissionEntity): Promise<RcofSubmissionEntity> {
    if (!rcof.trackId) {
      return rcof;
    }
    try {
      const result = await firstValueFrom(
        this.siiSoapClient.queryTrackStatus(rcof.trackId, 'rcof-poll'),
      );
      const mapped: RcofSubmissionEntity['status'] =
        result.status === 'ACEPTADO'
          ? 'accepted'
          : result.status === 'REPARO'
            ? 'observed'
            : result.status === 'RECHAZADO'
              ? 'rejected'
              : rcof.status;
      if (mapped !== rcof.status) {
        const updated = await firstValueFrom(
          this.dataServices.rcofSubmission.update(rcof.id!, {
            status: mapped,
            siiResponse: { ...(rcof.siiResponse || {}), lastStatus: result.status, polledAt: new Date().toISOString() },
          } as any),
        );
        return updated!;
      }
    } catch (err) {
      this.logger.warn(`Poll de RCOF ${rcof.id} falló: ${(err as Error).message}`);
    }
    return rcof;
  }

  /** Consolidación diaria: boletas 39/41 no-BORRADOR del día, con anulados. */
  private async consolidateDay(tenantId: string, date: string): Promise<any[]> {
    const documents = await firstValueFrom(this.dataServices.dteDocument.getAll());
    const boletas = documents.filter((d: any) => {
      if ((d.type !== 39 && d.type !== 41) || d.status === 'BORRADOR') {
        return false;
      }
      const issueDate =
        GenerateRcofUseCase.extractXmlValue(d.xmlContent, 'FchEmis') ??
        (d.createdAt ? new Date(d.createdAt).toISOString().slice(0, 10) : undefined);
      return issueDate === date;
    });
    if (boletas.length === 0) {
      return [];
    }

    return ([39, 41] as const).flatMap((type) => {
      const byType = boletas.filter((d: any) => d.type === type);
      if (byType.length === 0) {
        return [];
      }
      const activeFolios = byType
        .filter((d: any) => d.status !== 'ANULADO')
        .map((d: any) => d.folio)
        .sort((a: number, b: number) => a - b);
      return [
        {
          type,
          netAmount: byType.reduce((s: number, d: any) => s + GenerateRcofUseCase.xmlAmount(d.xmlContent, 'MntNeto'), 0),
          ivaAmount: byType.reduce((s: number, d: any) => s + GenerateRcofUseCase.xmlAmount(d.xmlContent, 'IVA'), 0),
          exemptAmount: byType.reduce((s: number, d: any) => s + GenerateRcofUseCase.xmlAmount(d.xmlContent, 'MntExe'), 0),
          totalAmount: byType.reduce((s: number, d: any) => s + GenerateRcofUseCase.xmlAmount(d.xmlContent, 'MntTotal'), 0),
          foliosEmitidos: byType.length,
          foliosAnulados: byType.filter((d: any) => d.status === 'ANULADO').length,
          foliosUtilizados: activeFolios.length,
          ranges: GenerateRcofUseCase.folioRanges(activeFolios),
        },
      ];
    });
  }

  private async buildAndSign(tenantId: string, date: string, sequence: number, summaries: any[]): Promise<string> {
    const tenant = await firstValueFrom(this.dataServices.tenant.get(tenantId));
    const signature = await this.tenantConfigService.getDecryptedSignature(tenantId);
    let pfxBase64: string;
    let password: string;
    let senderRut: string;

    if (signature) {
      pfxBase64 = signature.pfxBase64;
      password = signature.passwordString;
      senderRut = signature.metadata?.representativeRut || tenant!.rut;
    } else {
      if (process.env.NODE_ENV === 'production') {
        throw new IntegrationApiException(
          IntegrationErrorCode.VALIDATION_ERROR,
          'No se puede generar RCOF en producción sin firma digital vigente.',
          422,
        );
      }
      const cert = CertificateUtils.generateMockChileanCertificate(
        tenant!.rut,
        tenant!.businessName,
        '12345678-9',
        'REPRESENTANTE CONSUMO FOLIO',
      );
      pfxBase64 = cert.pfxBase64;
      password = cert.password;
      senderRut = '12345678-9';
    }

    const unsigned = this.dteXmlEngine.buildRcof({
      issuerRut: tenant!.rut,
      senderRut,
      sequenceNumber: sequence,
      startDate: date,
      endDate: date,
      summaries,
    } as any);
    const { signedXml } = this.signatureEngine.signXml(unsigned, pfxBase64, password, 'Doc_RCOF');
    return signedXml;
  }

  private async buildEnvelope(
    tenantId: string,
    signedRcofXml: string,
  ): Promise<{ envelopeXml: string; token: string }> {
    const tenant = await firstValueFrom(this.dataServices.tenant.get(tenantId));
    const signature = await this.tenantConfigService.getDecryptedSignature(tenantId);
    let pfxBase64: string;
    let password: string;
    let senderRut: string;
    if (signature) {
      pfxBase64 = signature.pfxBase64;
      password = signature.passwordString;
      senderRut = signature.metadata?.representativeRut || tenant!.rut;
    } else {
      const cert = CertificateUtils.generateMockChileanCertificate(
        tenant!.rut,
        tenant!.businessName,
        '12345678-9',
        'REPRESENTANTE CONSUMO FOLIO',
      );
      pfxBase64 = cert.pfxBase64;
      password = cert.password;
      senderRut = '12345678-9';
    }

    const taxProfile = await this.tenantConfigService.requireTaxProfileForRealEmission(tenantId).catch(() => null);
    const tenantConfig = await this.tenantConfigService.getConfig(tenantId).catch(() => null);

    const envelope = this.dteXmlEngine.buildEnvioBoleta({
      issuerRut: tenant!.rut,
      senderRut,
      signedDtes: [signedRcofXml],
      resolutionDate: (taxProfile as any)?.resolutionDate,
      resolutionNumber: (taxProfile as any)?.resolutionNumber,
      softwareProvider: (tenantConfig as any)?.softwareProvider,
    } as any);
    const { signedXml } = this.signatureEngine.signXml(envelope, pfxBase64, password, 'EnvioBOLETA');

    const token: string = await this.siiAuthTokenService.getToken(tenantId, {
      pfxBase64,
      password,
    } as any);
    return { envelopeXml: signedXml, token };
  }

  private static extractXmlValue(xml: string, tag: string): string | undefined {
    if (!xml) {
      return undefined;
    }
    const match = xml.match(new RegExp(`<${tag}>([^<]+)</${tag}>`));
    return match?.[1];
  }

  private static xmlAmount(xml: string, tag: string): number {
    const value = GenerateRcofUseCase.extractXmlValue(xml, tag);
    return value ? parseInt(value, 10) || 0 : 0;
  }

  private static folioRanges(sortedFolios: number[]): Array<{ start: number; end: number }> {
    const ranges: Array<{ start: number; end: number }> = [];
    let start: number | null = null;
    let prev: number | null = null;
    for (const folio of sortedFolios) {
      if (start === null) {
        start = folio;
      } else if (prev !== null && folio !== prev + 1) {
        ranges.push({ start, end: prev });
        start = folio;
      }
      prev = folio;
    }
    if (start !== null && prev !== null) {
      ranges.push({ start, end: prev });
    }
    return ranges;
  }
}
