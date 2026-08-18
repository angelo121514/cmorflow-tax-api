// backend/src/application/integrations/integration-request.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import { IDataServices, IntegrationRequestEntity, DteDocumentEntity } from '@domain';
import { DteXmlEngine } from '../../infrastructure/framework/sii/dte-xml.engine';
import { IntegrationApiException } from './integration-api.exception';
import { IntegrationErrorCode } from './integration-errors';
import { mapDteStatusToPublic } from './integration-state.service';
import { createHash } from 'crypto';

export type IntegrationRequestKind = 'dte' | 'credit-note' | 'debit-note' | 'rcof';

export interface EnqueueInput {
  tenantId: string;
  credentialId: string;
  kind: IntegrationRequestKind;
  idempotencyKey: string;
  rawBody: string;
  payload: any;
  externalReference?: string;
  metadata?: any;
}

/**
 * Creación idempotente de solicitudes B2B y composición de su estado público.
 *
 * Reglas de idempotencia (emisión y anulación):
 * - Sin `Idempotency-Key` → 400.
 * - Key repetida con mismo hash de body → se devuelve la respuesta original.
 * - Key repetida con body distinto → 409 IDEMPOTENCY_CONFLICT.
 * - `externalReference` repetida con otra key → 409 EXTERNAL_REFERENCE_CONFLICT.
 */
@Injectable()
export class IntegrationRequestService {
  private readonly logger = new Logger(IntegrationRequestService.name);

  constructor(
    private readonly dataServices: IDataServices,
    private readonly dteXmlEngine: DteXmlEngine,
  ) {}

  static hashBody(rawBody: string | Buffer): string {
    return createHash('sha256')
      .update(Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody))
      .digest('hex');
  }

  async enqueue(input: EnqueueInput): Promise<{ request: IntegrationRequestEntity; replayed: boolean }> {
    const requestHash = IntegrationRequestService.hashBody(input.rawBody);

    const existing = await firstValueFrom(
      this.dataServices.integrationRequest.findOne({
        where: { tenantId: input.tenantId, idempotencyKey: input.idempotencyKey },
      }),
    );
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new IntegrationApiException(
          IntegrationErrorCode.IDEMPOTENCY_CONFLICT,
          'El Idempotency-Key ya fue usado con un payload distinto.',
          409,
        );
      }
      return { request: existing, replayed: true };
    }

    if (input.externalReference) {
      const byRef = await firstValueFrom(
        this.dataServices.integrationRequest.findOne({
          where: { tenantId: input.tenantId, externalReference: input.externalReference },
        }),
      );
      if (byRef && byRef.idempotencyKey !== input.idempotencyKey) {
        throw new IntegrationApiException(
          IntegrationErrorCode.EXTERNAL_REFERENCE_CONFLICT,
          `externalReference "${input.externalReference}" ya está usada por otra solicitud.`,
          409,
        );
      }
    }

    const request = await firstValueFrom(
      this.dataServices.integrationRequest.create({
        tenantId: input.tenantId,
        kind: input.kind,
        idempotencyKey: input.idempotencyKey,
        requestHash,
        externalReference: input.externalReference ?? null,
        payload: input.payload,
        metadata: input.metadata ?? null,
        state: 'queued',
        originCredentialId: input.credentialId,
        attempts: 0,
        maxAttempts: 5,
        nextAttemptAt: new Date(),
        stateHistory: [
          { state: 'queued', timestamp: new Date().toISOString(), detail: 'Solicitud recibida (202).' },
        ],
      } as any),
    );
    this.logger.log(
      `Solicitud ${request.id} (${input.kind}) encolada para tenant ${input.tenantId}`,
    );
    return { request, replayed: false };
  }

  /** Snapshot 202 persistido para replays idempotentes. */
  async storeResponseSnapshot(requestId: string, snapshot: any): Promise<void> {
    await firstValueFrom(
      this.dataServices.integrationRequest.update(requestId, {
        responseSnapshot: snapshot,
      } as any),
    );
  }

  async findByDteId(tenantId: string, dteId: string): Promise<IntegrationRequestEntity | null> {
    return firstValueFrom(
      this.dataServices.integrationRequest.findOne({ where: { tenantId, dteId } }),
    );
  }

  async findByExternalReference(
    tenantId: string,
    externalReference: string,
  ): Promise<IntegrationRequestEntity | null> {
    return firstValueFrom(
      this.dataServices.integrationRequest.findOne({ where: { tenantId, externalReference } }),
    );
  }

  /**
   * Estado público consolidado: estado de la solicitud + folio/trackId del DTE
   * + estado SII derivado. La consulta es la fuente de verdad del integrador.
   */
  async buildStatus(request: IntegrationRequestEntity): Promise<any> {
    const dte = request.dteId
      ? await firstValueFrom(this.dataServices.dteDocument.get(request.dteId))
      : null;

    const siiStatus = dte ? mapDteStatusToPublic(dte.status) : null;
    // El estado SII refresca el estado público cuando la solicitud seguía
    // viva (submitted/processing): una vez finalizado, la solicitud manda.
    let effectiveState = request.state;
    if (siiStatus && ['submitted', 'processing'].includes(request.state) && siiStatus !== 'processing') {
      effectiveState = siiStatus as any;
    }

    return {
      requestId: request.id,
      kind: request.kind,
      status: effectiveState,
      externalReference: request.externalReference ?? null,
      metadata: request.metadata ?? null,
      dte: dte
        ? {
            dteId: dte.id,
            documentType: dte.type,
            folio: dte.folio,
            internalStatus: dte.status,
            siiStatus: dte.status,
            trackId: dte.trackId ?? null,
            amount: dte.amount,
          }
        : null,
      rcof: request.rcofId
        ? await this.buildRcofStatus(request.rcofId, request.tenantId)
        : null,
      error: request.lastError ?? null,
      attempts: request.attempts,
      createdAt: request.createdAt,
      submittedAt: request.submittedAt ?? null,
      finalizedAt: request.finalizedAt ?? null,
      _links: {
        self: `/api/v1/integrations/dte/${request.id}`,
        ...(dte
          ? {
              xml: `/api/v1/integrations/dte/${dte.id}/xml`,
              pdf: `/api/v1/integrations/dte/${dte.id}/pdf`,
            }
          : {}),
      },
    };
  }

  private async buildRcofStatus(rcofId: string, tenantId: string): Promise<any> {
    const rcof = await firstValueFrom(this.dataServices.rcofSubmission.get(rcofId));
    if (!rcof || rcof.tenantId !== tenantId) {
      return { rcofId, status: 'unknown' };
    }
    return {
      rcofId,
      periodDate: rcof.periodDate,
      sequence: rcof.sequence,
      status: rcof.status,
      trackId: rcof.trackId ?? null,
    };
  }

  /**
   * Validación condicional por tipo de DTE + recálculo de totales del
   * servidor. No se confía en los montos declarados por el integrador.
   * `allowNoteTypes` habilita 56/61 para los endpoints de notas (exigen
   * references no vacío).
   */
  validatePayloadAndTotals(
    payload: any,
    options: { allowNoteTypes?: boolean } = {},
  ): { totals: any; emitDto: any } {
    const type = payload.documentType;
    const supported = [33, 34, 39, 41, 46, 52, 56, 61];
    if (!supported.includes(type)) {
      throw new IntegrationApiException(
        IntegrationErrorCode.VALIDATION_ERROR,
        `documentType inválido. Soportados: ${supported.join(', ')}.`,
        422,
      );
    }
    const isNote = type === 56 || type === 61;
    if (isNote && !options.allowNoteTypes) {
      throw new IntegrationApiException(
        IntegrationErrorCode.VALIDATION_ERROR,
        'Las notas de crédito (61) y débito (56) se emiten vía /credit-notes y /debit-notes.',
        422,
      );
    }
    if (isNote && (!Array.isArray(payload.references) || payload.references.length === 0)) {
      throw new IntegrationApiException(
        IntegrationErrorCode.VALIDATION_ERROR,
        `La nota tipo ${type} exige al menos una referencia al documento original.`,
        422,
      );
    }

    const items = payload.items || [];
    if (!Array.isArray(items) || items.length === 0) {
      throw new IntegrationApiException(
        IntegrationErrorCode.VALIDATION_ERROR,
        'items es obligatorio y debe tener al menos una línea.',
        422,
      );
    }
    for (const item of items) {
      if (typeof item.quantity !== 'number' || item.quantity <= 0) {
        throw new IntegrationApiException(
          IntegrationErrorCode.VALIDATION_ERROR,
          'Cada item requiere quantity > 0.',
          422,
        );
      }
      if (typeof item.unitPrice !== 'number' || item.unitPrice < 0) {
        throw new IntegrationApiException(
          IntegrationErrorCode.VALIDATION_ERROR,
          'Cada item requiere unitPrice >= 0.',
          422,
        );
      }
    }

    const receiver = payload.receiver;
    const needsReceiver = [33, 34, 46, 52].includes(type);
    if (needsReceiver && (!receiver?.rut || !receiver?.name)) {
      throw new IntegrationApiException(
        IntegrationErrorCode.VALIDATION_ERROR,
        `El documento tipo ${type} exige receiver.rut y receiver.name.`,
        422,
      );
    }

    // Exentas (34, 41): todos los ítems exentos. Afectas (39): ninguno exento.
    if (type === 34 || type === 41) {
      if (!items.every((i: any) => i.exempt)) {
        throw new IntegrationApiException(
          IntegrationErrorCode.VALIDATION_ERROR,
          `El documento tipo ${type} (exento) exige todos los ítems con exempt=true.`,
          422,
        );
      }
    }
    if (type === 39 && items.some((i: any) => i.exempt)) {
      throw new IntegrationApiException(
        IntegrationErrorCode.VALIDATION_ERROR,
        'La boleta afecta (39) no admite ítems exentos; use boleta exenta (41).',
        422,
      );
    }

    // Guía de despacho (52): modelo de transporte obligatorio.
    if (type === 52 && !payload.transport?.transferType) {
      throw new IntegrationApiException(
        IntegrationErrorCode.VALIDATION_ERROR,
        'La guía de despacho (52) exige transport.transferType.',
        422,
      );
    }

    // Recálculo de totales con el motor (descuentos, IVA 19%, redondeo CLP).
    const engineItems = items.map((i: any) => ({
      name: i.name,
      quantity: i.quantity,
      price: i.unitPrice,
      exempt: i.exempt,
      discountPercentage: i.discountPercentage,
      discountAmount: i.discountAmount,
    }));
    const totals = this.dteXmlEngine.calculateTotals(type as any, engineItems as any);

    // Si el integrador declaró totales, deben coincidir con los del servidor.
    if (payload.totals) {
      const declared = payload.totals;
      const compare: Array<[string, number]> = [
        ['netAmount', totals.netAmount],
        ['exemptAmount', totals.exemptAmount],
        ['ivaAmount', totals.ivaAmount],
        ['totalAmount', totals.totalAmount],
      ];
      for (const [field, expected] of compare) {
        if (declared[field] !== undefined && Math.abs(Number(declared[field]) - expected) > 1) {
          throw new IntegrationApiException(
            IntegrationErrorCode.TOTALS_MISMATCH,
            `totals.${field} declarado ${declared[field]} ≠ calculado ${expected}. El servidor recalcula y valida los montos.`,
            422,
          );
        }
      }
    }

    // Traducción al contrato interno del motor (EmitDteDto), sin duplicarlo.
    const emitDto: any = {
      type,
      receiverRut: receiver?.rut,
      receiverName: receiver?.name,
      receiverGiro: receiver?.giro,
      receiverAddress: receiver?.address,
      receiverCommune: receiver?.commune,
      amount: totals.totalAmount,
      items: engineItems,
      references: payload.references,
      pricingMode: payload.pricingMode,
      indServicio: payload.indServicio,
      indTraslado: payload.indTraslado,
      transport: payload.transport,
      taxRetentions: payload.taxRetentions,
      globalDiscountPercentage: payload.globalDiscountPercentage,
    };
    return { totals, emitDto };
  }
}
