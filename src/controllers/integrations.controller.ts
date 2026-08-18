// backend/src/controllers/integrations.controller.ts
import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Headers,
  HttpCode,
  HttpStatus,
  UseGuards,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiSecurity } from '@nestjs/swagger';
import { ClsService } from 'nestjs-cls';
import { firstValueFrom } from 'rxjs';
import { Response } from 'express';
import { Public } from '../infrastructure/decorators/public.decorator';
import { IDataServices } from '@domain';
import { IntegrationHmacGuard } from '../infrastructure/guards/integration-hmac.guard';
import { IntegrationPermission } from '../infrastructure/decorators/integration-permission.decorator';
import { IntegrationCredentialsUseCase } from '../application/integrations/integration-credentials.use-case';
import { IntegrationRequestService } from '../application/integrations/integration-request.service';
import { IntegrationProcessorService } from '../application/integrations/integration-processor.service';
import { IntegrationArtifactsService } from '../application/integrations/integration-artifacts.service';
import { IntegrationWebhookService } from '../application/integrations/integration-webhook.service';
import { IntegrationApiException } from '../application/integrations/integration-api.exception';
import { IntegrationErrorCode } from '../application/integrations/integration-errors';
import {
  CreateIntegrationDteDto,
  CreateIntegrationNoteDto,
  CreateIntegrationRcofDto,
} from './dtos/create-integration-dte.dto';
import {
  CreateIntegrationCredentialDto,
  RegisterWebhookEndpointDto,
} from './dtos/integration-admin.dto';

/**
 * API B2B tributaria para CMORAPR y futuros integradores.
 *
 * Superficie pública (`/api/v1/integrations`): autenticación HMAC por
 * credencial ligada a un único tenant, flujo asíncrono 202 + consulta +
 * webhooks. Superficie administrativa (JWT interno + permiso
 * INTEGRATION_MANAGE): ciclo de vida de credenciales y webhooks.
 *
 * El motor DTE interno no se duplica: la fachada traduce su contrato a los
 * casos de uso existentes (EmitDteUseCase.prepare/transmit, GenerateRcof…).
 */
@ApiTags('integrations')
@ApiSecurity('integration-hmac')
@Controller('integrations')
export class IntegrationsController {
  constructor(
    private readonly cls: ClsService,
    private readonly dataServices: IDataServices,
    private readonly credentialsUseCase: IntegrationCredentialsUseCase,
    private readonly requestService: IntegrationRequestService,
    private readonly processor: IntegrationProcessorService,
    private readonly artifactsService: IntegrationArtifactsService,
    private readonly webhookService: IntegrationWebhookService,
  ) {}

  // ══════════════ Administración (JWT interno) ══════════════

  @Post('credentials')
  @Public()
  @UseGuards(IntegrationHmacGuard)
  @IntegrationPermission('credentials:write')
  @ApiOperation({ summary: '[Admin] Crear credencial B2B — el secreto se muestra UNA sola vez' })
  @ApiResponse({ status: 201, description: 'Credencial creada con secreto inicial.' })
  async createCredential(@Body() dto: CreateIntegrationCredentialDto, @Req() request: any) {
    const tenantId = this.cls.get('tenantId');
    return this.credentialsUseCase.create(tenantId, {
      name: dto.name,
      credentialType: (dto as any).credentialType ?? 'api',
      permissions: dto.permissions as any,
      expiresInDays: dto.expiresInDays,
    });
  }

  @Get('credentials')
  @Public()
  @UseGuards(IntegrationHmacGuard)
  @IntegrationPermission('credentials:read')
  @ApiOperation({ summary: '[Admin] Listar credenciales (enmascaradas)' })
  async listCredentials() {
    return this.credentialsUseCase.list(this.cls.get('tenantId'));
  }

  @Post('credentials/:id/rotate')
  @Public()
  @UseGuards(IntegrationHmacGuard)
  @IntegrationPermission('credentials:write')
  @ApiOperation({ summary: '[Admin] Rotar credencial — la antigua vive 24h de gracia' })
  async rotateCredential(@Param('id') id: string) {
    return this.credentialsUseCase.rotate(this.cls.get('tenantId'), id);
  }

  @Post('credentials/:id/revoke')
  @Public()
  @UseGuards(IntegrationHmacGuard)
  @IntegrationPermission('credentials:write')
  @ApiOperation({ summary: '[Admin] Revocar credencial inmediatamente' })
  async revokeCredential(@Param('id') id: string, @Req() request: any) {
    const tenantId = this.cls.get('tenantId');
    return this.credentialsUseCase.revoke(tenantId, id, {
      actorCredentialId: request.integrationCredential?.id,
    });
  }

  @Post('webhooks')
  @Public()
  @UseGuards(IntegrationHmacGuard)
  @IntegrationPermission('webhooks:write')
  @ApiOperation({ summary: '[Admin] Registrar endpoint webhook — secreto de firma se muestra una vez' })
  async registerWebhook(@Body() dto: RegisterWebhookEndpointDto) {
    return this.webhookService.registerEndpoint(this.cls.get('tenantId'), dto);
  }

  @Get('webhooks')
  @Public()
  @UseGuards(IntegrationHmacGuard)
  @IntegrationPermission('webhooks:read')
  @ApiOperation({ summary: '[Admin] Listar endpoints webhook' })
  async listWebhooks() {
    return this.webhookService.listEndpoints(this.cls.get('tenantId'));
  }

  @Post('webhooks/:id/deactivate')
  @Public()
  @UseGuards(IntegrationHmacGuard)
  @IntegrationPermission('webhooks:write')
  @ApiOperation({ summary: '[Admin] Desactivar endpoint webhook' })
  async deactivateWebhook(@Param('id') id: string) {
    return this.webhookService.deactivateEndpoint(this.cls.get('tenantId'), id);
  }

  @Post('webhooks/events/:eventId/redeliver')
  @Public()
  @UseGuards(IntegrationHmacGuard)
  @IntegrationPermission('webhooks:write')
  @ApiOperation({ summary: '[Admin] Reenviar un evento webhook manualmente' })
  async redeliverEvent(@Param('eventId') eventId: string) {
    return this.webhookService.redeliver(this.cls.get('tenantId'), eventId);
  }

  @Get('webhooks/deliveries')
  @Public()
  @UseGuards(IntegrationHmacGuard)
  @IntegrationPermission('webhooks:read')
  @ApiOperation({ summary: '[Admin] Historial de entregas webhook (últimas 50)' })
  async deliveryHistory(@Query('eventId') eventId?: string) {
    return this.webhookService.deliveryHistory(this.cls.get('tenantId'), eventId);
  }

  // ══════════════ Superficie pública B2B (HMAC) ══════════════

  @Post('dte')
  @Public()
  @UseGuards(IntegrationHmacGuard)
  @IntegrationPermission('dte:emit')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Emitir un DTE (33/34/39/41/46/52) de forma asíncrona',
    description:
      'Responde 202 con requestId. Requiere header Idempotency-Key: reintentos con la misma key y el mismo body devuelven la misma respuesta; body distinto con la misma key → 409.',
  })
  @ApiResponse({ status: 202, description: 'Solicitud aceptada y encolada.' })
  @ApiResponse({ status: 400, description: 'Falta Idempotency-Key o headers HMAC.' })
  @ApiResponse({ status: 401, description: 'Firma/nonce/timestamp inválidos.' })
  @ApiResponse({ status: 409, description: 'Conflicto de idempotencia o externalReference.' })
  @ApiResponse({ status: 422, description: 'Validación tributaria o totales.' })
  @ApiResponse({ status: 429, description: 'Rate limit de la credencial.' })
  async emitDte(
    @Body() dto: CreateIntegrationDteDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: any,
  ) {
    const { tenantId } = this.requireIntegrationContext(request);
    this.requireIdempotencyKey(idempotencyKey);

    const payload = { ...dto, serverTotals: undefined };
    const { totals } = this.requestService.validatePayloadAndTotals(payload);
    payload.serverTotals = totals;

    return this.enqueueAndKick(
      tenantId,
      request.integrationCredential.id,
      'dte',
      idempotencyKey!,
      request.rawBody,
      payload,
    );
  }

  @Get('dte')
  @Public()
  @UseGuards(IntegrationHmacGuard)
  @IntegrationPermission('dte:read')
  @ApiOperation({ summary: 'Reconciliar solicitudes por referencia externa' })
  async getByExternalReference(@Query('externalReference') externalReference: string) {
    const tenantId = this.cls.get('tenantId');
    if (!externalReference) {
      throw new IntegrationApiException(
        IntegrationErrorCode.VALIDATION_ERROR,
        'Query param externalReference es obligatorio.',
        400,
      );
    }
    const request = await this.requestService.findByExternalReference(tenantId, externalReference);
    if (!request) {
      throw new IntegrationApiException(
        IntegrationErrorCode.NOT_FOUND,
        `No hay solicitudes con externalReference ${externalReference}.`,
        404,
      );
    }
    return this.requestService.buildStatus(request);
  }

  @Get('dte/:id')
  @Public()
  @UseGuards(IntegrationHmacGuard)
  @IntegrationPermission('dte:read')
  @ApiOperation({
    summary: 'Estado de una solicitud (por requestId o dteId)',
    description: 'Fuente de verdad del integrador: estado público, folio, TrackID y errores.',
  })
  async getStatus(@Param('id') id: string) {
    const tenantId = this.cls.get('tenantId');
    let request = await firstValueFrom(
      this.dataServices.integrationRequest.findOne({ where: { tenantId, id } }),
    );
    if (!request) {
      request = await this.requestService.findByDteId(tenantId, id);
    }
    if (!request) {
      throw new IntegrationApiException(
        IntegrationErrorCode.NOT_FOUND,
        'Solicitud o DTE no encontrado para esta credencial.',
        404,
      );
    }
    return this.requestService.buildStatus(request as any);
  }

  @Post('dte/:dteId/credit-notes')
  @Public()
  @UseGuards(IntegrationHmacGuard)
  @IntegrationPermission('dte:emit')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Emitir nota de crédito (61) del documento original' })
  async emitCreditNote(
    @Param('dteId') dteId: string,
    @Body() dto: CreateIntegrationNoteDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: any,
  ) {
    return this.emitNote(request, dteId, dto, idempotencyKey, 61, 'credit-note');
  }

  @Post('dte/:dteId/debit-notes')
  @Public()
  @UseGuards(IntegrationHmacGuard)
  @IntegrationPermission('dte:emit')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Emitir nota de débito (56) del documento original' })
  async emitDebitNote(
    @Param('dteId') dteId: string,
    @Body() dto: CreateIntegrationNoteDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: any,
  ) {
    return this.emitNote(request, dteId, dto, idempotencyKey, 56, 'debit-note');
  }

  @Get('dte/:dteId/xml')
  @Public()
  @UseGuards(IntegrationHmacGuard)
  @IntegrationPermission('artifacts:read')
  @ApiOperation({ summary: 'Descargar el XML firmado del DTE (autenticado)' })
  async downloadXml(@Param('dteId') dteId: string, @Res() res: Response) {
    const { xml, dte } = await this.artifactsService.getXml(this.cls.get('tenantId'), dteId);
    res.set({
      'Content-Type': 'application/xml',
      'Content-Disposition': `attachment; filename="DTE_${dte.type}_Folio_${dte.folio}.xml"`,
    });
    res.end(xml);
  }

  @Get('dte/:dteId/pdf')
  @Public()
  @UseGuards(IntegrationHmacGuard)
  @IntegrationPermission('artifacts:read')
  @ApiOperation({ summary: 'Descargar el PDF del DTE (autenticado)' })
  async downloadPdf(@Param('dteId') dteId: string, @Res() res: Response) {
    const { pdf, dte } = await this.artifactsService.getPdf(this.cls.get('tenantId'), dteId);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="DTE_${dte.type}_Folio_${dte.folio}.pdf"`,
      'Content-Length': pdf.length,
    });
    res.end(pdf);
  }

  @Post('dte/:dteId/artifact-links')
  @Public()
  @UseGuards(IntegrationHmacGuard)
  @IntegrationPermission('artifacts:read')
  @ApiOperation({ summary: 'Generar URLs firmadas de corta duración (XML y PDF)' })
  async createArtifactLinks(@Param('dteId') dteId: string) {
    const tenantId = this.cls.get('tenantId');
    const xml = await this.artifactsService.createSignedUrl(tenantId, dteId, 'xml');
    const pdf = await this.artifactsService.createSignedUrl(tenantId, dteId, 'pdf');
    return {
      xmlUrl: xml.url,
      pdfUrl: pdf.url,
      expiresAt: xml.expiresAt,
    };
  }

  /** Descarga por token firmado — sin HMAC, el token ES la autorización. */
  @Get('artifacts/:token')
  @Public()
  @ApiOperation({ summary: 'Descargar artefacto con URL firmada (sin headers HMAC)' })
  async downloadByToken(@Param('token') token: string, @Res() res: Response) {
    const payload = this.artifactsService.verifySignedUrl(token);
    this.cls.set('tenantId', payload.tenantId);
    if (payload.kind === 'xml') {
      const { xml, dte } = await this.artifactsService.getXml(payload.tenantId, payload.dteId);
      res.set({
        'Content-Type': 'application/xml',
        'Content-Disposition': `attachment; filename="DTE_${dte.type}_Folio_${dte.folio}.xml"`,
      });
      return res.end(xml);
    }
    const { pdf, dte } = await this.artifactsService.getPdf(payload.tenantId, payload.dteId);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="DTE_${dte.type}_Folio_${dte.folio}.pdf"`,
      'Content-Length': pdf.length,
    });
    res.end(pdf);
  }

  @Post('rcof')
  @Public()
  @UseGuards(IntegrationHmacGuard)
  @IntegrationPermission('dte:emit')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Solicitar generación y transmisión del RCOF de una fecha',
    description: 'Idempotente por tenant, fecha y secuencia.',
  })
  async createRcof(
    @Body() dto: CreateIntegrationRcofDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: any,
  ) {
    const { tenantId } = this.requireIntegrationContext(request);
    this.requireIdempotencyKey(idempotencyKey);
    return this.enqueueAndKick(
      tenantId,
      request.integrationCredential.id,
      'rcof',
      idempotencyKey!,
      request.rawBody,
      { date: dto.date, sequenceNumber: dto.sequenceNumber ?? 1 },
    );
  }

  @Get('rcof/:id')
  @Public()
  @UseGuards(IntegrationHmacGuard)
  @IntegrationPermission('dte:read')
  @ApiOperation({ summary: 'Estado del RCOF (estado, TrackID, XML)' })
  async getRcofStatus(@Param('id') id: string) {
    const tenantId = this.cls.get('tenantId');
    const request = await firstValueFrom(
      this.dataServices.integrationRequest.findOne({ where: { tenantId, id } }),
    );
    if (!request) {
      // También se acepta el id directo del rcof_submission.
      const rcof = await firstValueFrom(this.dataServices.rcofSubmission.get(id));
      if (!rcof || rcof.tenantId !== tenantId) {
        throw new IntegrationApiException(
          IntegrationErrorCode.NOT_FOUND,
          'RCOF no encontrado para esta credencial.',
          404,
        );
      }
      return {
        rcofId: rcof.id,
        periodDate: rcof.periodDate,
        sequence: rcof.sequence,
        status: rcof.status,
        trackId: rcof.trackId ?? null,
        siiResponse: rcof.siiResponse ?? null,
        createdAt: rcof.createdAt,
      };
    }
    return this.requestService.buildStatus(request as any);
  }

  // ══════════════ Privados ══════════════

  private async emitNote(
    request: any,
    originalDteId: string,
    dto: CreateIntegrationNoteDto,
    idempotencyKey: string | undefined,
    noteType: 56 | 61,
    kind: 'credit-note' | 'debit-note',
  ) {
    const { tenantId } = this.requireIntegrationContext(request);
    this.requireIdempotencyKey(idempotencyKey);

    const original = await this.artifactsService.getXml(tenantId, originalDteId).catch(() => null);
    if (!original) {
      throw new IntegrationApiException(
        IntegrationErrorCode.NOT_FOUND,
        'El documento original no pertenece a esta credencial.',
        404,
      );
    }
    const issueDate =
      (original.dte.xmlContent || '').match(/<FchEmis>([^<]+)<\/FchEmis>/)?.[1] ??
      (original.dte.createdAt ? new Date(original.dte.createdAt).toISOString().slice(0, 10) : '');

    const payload: any = {
      documentType: noteType,
      receiver: {
        rut: original.dte.receiverRut,
        name: original.dte.receiverName,
      },
      items: dto.items,
      references: [
        {
          type: original.dte.type,
          folio: original.dte.folio,
          date: issueDate,
          reasonCode: dto.reasonCode,
          reason: dto.reason,
        },
      ],
      totals: dto.totals,
      externalReference: dto.externalReference,
      metadata: dto.metadata,
    };
    const { totals } = this.requestService.validatePayloadAndTotals(payload, {
      allowNoteTypes: true,
    });
    payload.serverTotals = totals;

    return this.enqueueAndKick(
      tenantId,
      request.integrationCredential.id,
      kind,
      idempotencyKey!,
      request.rawBody,
      payload,
    );
  }

  /** Encola (idempotente), guarda el snapshot 202 y dispara el procesamiento. */
  private async enqueueAndKick(
    tenantId: string,
    credentialId: string,
    kind: 'dte' | 'credit-note' | 'debit-note' | 'rcof',
    idempotencyKey: string,
    rawBody: Buffer | string,
    payload: any,
  ) {
    const { request, replayed } = await this.requestService.enqueue({
      tenantId,
      credentialId,
      kind,
      idempotencyKey,
      rawBody: rawBody ? rawBody.toString() : '',
      payload,
      externalReference: payload.externalReference,
      metadata: payload.metadata,
    });

    if (replayed) {
      // Reintento idempotente: misma respuesta 202 que la original.
      if (request.responseSnapshot) {
        return request.responseSnapshot;
      }
      return this.requestService.buildStatus(request);
    }

    const snapshot = {
      requestId: request.id,
      dteId: request.dteId ?? null,
      kind,
      status: 'queued',
      externalReference: request.externalReference ?? null,
      message: 'Solicitud recibida y encolada. Consulte GET /integrations/dte/{requestId} o espere webhooks.',
      _links: { self: `/api/v1/integrations/dte/${request.id}` },
    };
    await this.requestService.storeResponseSnapshot(request.id!, snapshot);

    // Procesamiento inmediato fire-and-forget; el reconciler es la red de seguridad.
    void this.processor.processDue(1).catch(() => undefined);

    return snapshot;
  }

  // El tenant se resuelve desde la credencial HMAC en el guard (CLS).

  private requireIntegrationContext(request: any): { tenantId: string } {
    const tenantId = this.cls.get('tenantId');
    if (!tenantId || !request.integrationCredential) {
      throw new IntegrationApiException(
        IntegrationErrorCode.PERMISSION_DENIED,
        'Contexto de integración ausente.',
        403,
      );
    }
    return { tenantId };
  }

  private requireIdempotencyKey(key: string | undefined): void {
    if (!key) {
      throw new IntegrationApiException(
        IntegrationErrorCode.IDEMPOTENCY_KEY_REQUIRED,
        'El header Idempotency-Key es obligatorio en emisión y anulación.',
        400,
      );
    }
  }

}
