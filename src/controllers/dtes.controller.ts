// src/controllers/dtes.controller.ts
import {
  Controller, Get, Post, Body, Param, Query, Headers,
  HttpCode, HttpStatus, UseGuards, Req, Res,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ClsService } from 'nestjs-cls';
import { firstValueFrom } from 'rxjs';
import { Response } from 'express';
import { Public } from '../infrastructure/decorators/public.decorator';
import { IDataServices } from '@domain';
import { IntegrationHmacGuard } from '../infrastructure/guards/integration-hmac.guard';
import { IntegrationPermission } from '../infrastructure/decorators/integration-permission.decorator';
import { IntegrationRequestService } from '../application/integrations/integration-request.service';
import { IntegrationProcessorService } from '../application/integrations/integration-processor.service';
import { IntegrationArtifactsService } from '../application/integrations/integration-artifacts.service';
import { IntegrationApiException } from '../application/integrations/integration-api.exception';
import { IntegrationErrorCode } from '../application/integrations/integration-errors';
import { CreateIntegrationDteDto, CreateIntegrationNoteDto } from './dtos/create-integration-dte.dto';
import { IntegrationControllerHelper } from './integration-controller.helper';

@ApiTags('dtes')
@Controller('dtes')
export class DtesController {
  constructor(
    private readonly cls: ClsService,
    private readonly dataServices: IDataServices,
    private readonly requestService: IntegrationRequestService,
    private readonly processor: IntegrationProcessorService,
    private readonly artifactsService: IntegrationArtifactsService,
    private readonly helper: IntegrationControllerHelper,
  ) {}

  @Post()
  @Public()
  @UseGuards(IntegrationHmacGuard)
  @IntegrationPermission('dte:emit')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Emitir un DTE (33/34/39/41/46/52) de forma asíncrona' })
  @ApiResponse({ status: 202, description: 'Solicitud aceptada y encolada.' })
  @ApiResponse({ status: 409, description: 'Conflicto de idempotencia o externalReference.' })
  @ApiResponse({ status: 422, description: 'Validación tributaria o totales.' })
  async emit(
    @Body() dto: CreateIntegrationDteDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: any,
  ) {
    this.helper.requireIdempotencyKey(idempotencyKey);
    const tenantId = this.cls.get('tenantId');
    const payload = { ...dto, serverTotals: undefined };
    const { totals } = this.requestService.validatePayloadAndTotals(payload);
    payload.serverTotals = totals;
    return this.helper.enqueueAndKick(tenantId, request.integrationCredential.id, 'dte', idempotencyKey!, request.rawBody, payload);
  }

  @Get()
  @Public()
  @UseGuards(IntegrationHmacGuard)
  @IntegrationPermission('dte:read')
  @ApiOperation({ summary: 'Reconciliar solicitudes por referencia externa' })
  async findByExternalReference(@Query('externalReference') externalReference: string) {
    const tenantId = this.cls.get('tenantId');
    if (!externalReference) {
      throw new IntegrationApiException(IntegrationErrorCode.VALIDATION_ERROR, 'Query param externalReference es obligatorio.', 400);
    }
    const request = await this.requestService.findByExternalReference(tenantId, externalReference);
    if (!request) {
      throw new IntegrationApiException(IntegrationErrorCode.NOT_FOUND, `No hay solicitudes con externalReference ${externalReference}.`, 404);
    }
    return this.requestService.buildStatus(request);
  }

  @Get(':id')
  @Public()
  @UseGuards(IntegrationHmacGuard)
  @IntegrationPermission('dte:read')
  @ApiOperation({ summary: 'Estado de una solicitud (por requestId o dteId)' })
  async getStatus(@Param('id') id: string) {
    const tenantId = this.cls.get('tenantId');
    let request = await firstValueFrom(this.dataServices.integrationRequest.findOne({ where: { tenantId, id } }));
    if (!request) request = await this.requestService.findByDteId(tenantId, id);
    if (!request) throw new IntegrationApiException(IntegrationErrorCode.NOT_FOUND, 'Solicitud o DTE no encontrado para esta credencial.', 404);
    return this.requestService.buildStatus(request as any);
  }

  @Post(':dteId/credit-notes')
  @Public()
  @UseGuards(IntegrationHmacGuard)
  @IntegrationPermission('dte:emit')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Emitir nota de crédito (61) del documento original' })
  async creditNote(@Param('dteId') dteId: string, @Body() dto: CreateIntegrationNoteDto, @Headers('idempotency-key') idempotencyKey: string | undefined, @Req() request: any) {
    return this.emitNote(request, dteId, dto, idempotencyKey, 61, 'credit-note');
  }

  @Post(':dteId/debit-notes')
  @Public()
  @UseGuards(IntegrationHmacGuard)
  @IntegrationPermission('dte:emit')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Emitir nota de débito (56) del documento original' })
  async debitNote(@Param('dteId') dteId: string, @Body() dto: CreateIntegrationNoteDto, @Headers('idempotency-key') idempotencyKey: string | undefined, @Req() request: any) {
    return this.emitNote(request, dteId, dto, idempotencyKey, 56, 'debit-note');
  }

  @Get(':dteId/xml')
  @Public()
  @UseGuards(IntegrationHmacGuard)
  @IntegrationPermission('artifacts:read')
  @ApiOperation({ summary: 'Descargar el XML firmado del DTE' })
  async downloadXml(@Param('dteId') dteId: string, @Res() res: Response) {
    const { xml, dte } = await this.artifactsService.getXml(this.cls.get('tenantId'), dteId);
    res.set({ 'Content-Type': 'application/xml', 'Content-Disposition': `attachment; filename="DTE_${dte.type}_Folio_${dte.folio}.xml"` });
    res.end(xml);
  }

  @Get(':dteId/pdf')
  @Public()
  @UseGuards(IntegrationHmacGuard)
  @IntegrationPermission('artifacts:read')
  @ApiOperation({ summary: 'Descargar el PDF del DTE' })
  async downloadPdf(@Param('dteId') dteId: string, @Res() res: Response) {
    const { pdf, dte } = await this.artifactsService.getPdf(this.cls.get('tenantId'), dteId);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="DTE_${dte.type}_Folio_${dte.folio}.pdf"`, 'Content-Length': pdf.length });
    res.end(pdf);
  }

  @Post(':dteId/artifact-links')
  @Public()
  @UseGuards(IntegrationHmacGuard)
  @IntegrationPermission('artifacts:read')
  @ApiOperation({ summary: 'Generar URLs firmadas de corta duración (XML y PDF)' })
  async artifactLinks(@Param('dteId') dteId: string) {
    const tenantId = this.cls.get('tenantId');
    const xml = await this.artifactsService.createSignedUrl(tenantId, dteId, 'xml');
    const pdf = await this.artifactsService.createSignedUrl(tenantId, dteId, 'pdf');
    return { xmlUrl: xml.url, pdfUrl: pdf.url, expiresAt: xml.expiresAt };
  }

  private async emitNote(request: any, originalDteId: string, dto: CreateIntegrationNoteDto, idempotencyKey: string | undefined, noteType: 56 | 61, kind: 'credit-note' | 'debit-note') {
    this.helper.requireIdempotencyKey(idempotencyKey);
    const tenantId = this.cls.get('tenantId');
    const original = await this.artifactsService.getXml(tenantId, originalDteId).catch(() => null);
    if (!original) throw new IntegrationApiException(IntegrationErrorCode.NOT_FOUND, 'El documento original no pertenece a esta credencial.', 404);
    const issueDate = (original.dte.xmlContent || '').match(/<FchEmis>([^<]+)<\/FchEmis>/)?.[1] ?? (original.dte.createdAt ? new Date(original.dte.createdAt).toISOString().slice(0, 10) : '');
    const payload: any = {
      documentType: noteType,
      receiver: { rut: original.dte.receiverRut, name: original.dte.receiverName },
      items: dto.items,
      references: [{ type: original.dte.type, folio: original.dte.folio, date: issueDate, reasonCode: dto.reasonCode, reason: dto.reason }],
      totals: dto.totals, externalReference: dto.externalReference, metadata: dto.metadata,
    };
    const { totals } = this.requestService.validatePayloadAndTotals(payload, { allowNoteTypes: true });
    payload.serverTotals = totals;
    return this.helper.enqueueAndKick(tenantId, request.integrationCredential.id, kind, idempotencyKey!, request.rawBody, payload);
  }
}