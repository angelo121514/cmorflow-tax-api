// src/controllers/rcof.controller.ts
import { Controller, Get, Post, Body, Param, Headers, HttpCode, HttpStatus, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ClsService } from 'nestjs-cls';
import { firstValueFrom } from 'rxjs';
import { Public } from '../infrastructure/decorators/public.decorator';
import { IDataServices } from '@domain';
import { IntegrationHmacGuard } from '../infrastructure/guards/integration-hmac.guard';
import { IntegrationPermission } from '../infrastructure/decorators/integration-permission.decorator';
import { IntegrationRequestService } from '../application/integrations/integration-request.service';
import { IntegrationApiException } from '../application/integrations/integration-api.exception';
import { IntegrationErrorCode } from '../application/integrations/integration-errors';
import { CreateIntegrationRcofDto } from './dtos/create-integration-dte.dto';
import { IntegrationControllerHelper } from './integration-controller.helper';

@ApiTags('rcof')
@Controller('rcof')
export class RcofController {
  constructor(
    private readonly cls: ClsService,
    private readonly dataServices: IDataServices,
    private readonly requestService: IntegrationRequestService,
    private readonly helper: IntegrationControllerHelper,
  ) {}

  @Post()
  @Public()
  @UseGuards(IntegrationHmacGuard)
  @IntegrationPermission('rcof:submit')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Solicitar generación y transmisión del RCOF de una fecha', description: 'Idempotente por tenant, fecha y secuencia.' })
  async create(@Body() dto: CreateIntegrationRcofDto, @Headers('idempotency-key') idempotencyKey: string | undefined, @Req() request: any) {
    this.helper.requireIdempotencyKey(idempotencyKey);
    const tenantId = this.cls.get('tenantId');
    return this.helper.enqueueAndKick(tenantId, request.integrationCredential.id, 'rcof', idempotencyKey!, request.rawBody, { date: dto.date, sequenceNumber: dto.sequenceNumber ?? 1 });
  }

  @Get(':id')
  @Public()
  @UseGuards(IntegrationHmacGuard)
  @IntegrationPermission('rcof:read')
  @ApiOperation({ summary: 'Estado del RCOF (estado, TrackID, respuesta SII)' })
  async getStatus(@Param('id') id: string) {
    const tenantId = this.cls.get('tenantId');
    const request = await firstValueFrom(this.dataServices.integrationRequest.findOne({ where: { tenantId, id } }));
    if (!request) {
      const rcof = await firstValueFrom(this.dataServices.rcofSubmission.get(id));
      if (!rcof || rcof.tenantId !== tenantId) {
        throw new IntegrationApiException(IntegrationErrorCode.NOT_FOUND, 'RCOF no encontrado para esta credencial.', 404);
      }
      return { rcofId: rcof.id, periodDate: rcof.periodDate, sequence: rcof.sequence, status: rcof.status, trackId: rcof.trackId ?? null, siiResponse: rcof.siiResponse ?? null, createdAt: rcof.createdAt };
    }
    return this.requestService.buildStatus(request as any);
  }
}