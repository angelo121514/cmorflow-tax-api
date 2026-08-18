// src/controllers/integration-controller.helper.ts
import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { IntegrationRequestService } from '../application/integrations/integration-request.service';
import { IntegrationProcessorService } from '../application/integrations/integration-processor.service';
import { IntegrationApiException } from '../application/integrations/integration-api.exception';
import { IntegrationErrorCode } from '../application/integrations/integration-errors';

/** Métodos compartidos por los controllers de la Tax API. */
@Injectable()
export class IntegrationControllerHelper {
  constructor(
    private readonly cls: ClsService,
    private readonly requestService: IntegrationRequestService,
    private readonly processor: IntegrationProcessorService,
  ) {}

  requireIdempotencyKey(key: string | undefined): void {
    if (!key) {
      throw new IntegrationApiException(
        IntegrationErrorCode.IDEMPOTENCY_KEY_REQUIRED,
        'El header Idempotency-Key es obligatorio en emisión y anulación.',
        400,
      );
    }
  }

  async enqueueAndKick(
    tenantId: string,
    credentialId: string,
    kind: 'dte' | 'credit-note' | 'debit-note' | 'rcof',
    idempotencyKey: string,
    rawBody: Buffer | string | undefined,
    payload: any,
  ) {
    const { request, replayed } = await this.requestService.enqueue({
      tenantId, credentialId, kind, idempotencyKey,
      rawBody: rawBody ? rawBody.toString() : '',
      payload,
      externalReference: payload.externalReference,
      metadata: payload.metadata,
    });
    if (replayed) {
      return request.responseSnapshot ?? this.requestService.buildStatus(request);
    }
    const resource = kind === 'rcof' ? 'rcof' : 'dtes';
    const snapshot = {
      requestId: request.id,
      dteId: request.dteId ?? null,
      kind,
      status: 'queued',
      externalReference: request.externalReference ?? null,
      message: `Solicitud recibida y encolada. Consulte GET /api/v1/${resource}/${request.id} o espere webhooks.`,
      _links: { self: `/api/v1/${resource}/${request.id}` },
    };
    await this.requestService.storeResponseSnapshot(request.id!, snapshot);
    void this.processor.processDue(1).catch(() => undefined);
    return snapshot;
  }
}