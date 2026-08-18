// src/controllers/webhooks.controller.ts
import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ClsService } from 'nestjs-cls';
import { Public } from '../infrastructure/decorators/public.decorator';
import { IntegrationHmacGuard } from '../infrastructure/guards/integration-hmac.guard';
import { IntegrationPermission } from '../infrastructure/decorators/integration-permission.decorator';
import { IntegrationWebhookService } from '../application/integrations/integration-webhook.service';
import { RegisterWebhookEndpointDto } from './dtos/integration-admin.dto';

@ApiTags('webhooks')
@Controller('webhooks')
export class WebhooksController {
  constructor(
    private readonly cls: ClsService,
    private readonly webhookService: IntegrationWebhookService,
  ) {}

  @Post()
  @Public()
  @UseGuards(IntegrationHmacGuard)
  @IntegrationPermission('webhooks:write')
  @ApiOperation({ summary: '[Admin] Registrar endpoint webhook — secreto de firma se muestra una vez' })
  async register(@Body() dto: RegisterWebhookEndpointDto) {
    return this.webhookService.registerEndpoint(this.cls.get('tenantId'), dto);
  }

  @Get()
  @Public()
  @UseGuards(IntegrationHmacGuard)
  @IntegrationPermission('webhooks:read')
  @ApiOperation({ summary: '[Admin] Listar endpoints webhook' })
  async list() {
    return this.webhookService.listEndpoints(this.cls.get('tenantId'));
  }

  @Post(':id/deactivate')
  @Public()
  @UseGuards(IntegrationHmacGuard)
  @IntegrationPermission('webhooks:write')
  @ApiOperation({ summary: '[Admin] Desactivar endpoint webhook' })
  async deactivate(@Param('id') id: string) {
    return this.webhookService.deactivateEndpoint(this.cls.get('tenantId'), id);
  }

  @Post('events/:eventId/redeliver')
  @Public()
  @UseGuards(IntegrationHmacGuard)
  @IntegrationPermission('webhooks:write')
  @ApiOperation({ summary: '[Admin] Reenviar un evento webhook manualmente' })
  async redeliver(@Param('eventId') eventId: string) {
    return this.webhookService.redeliver(this.cls.get('tenantId'), eventId);
  }

  @Get('deliveries')
  @Public()
  @UseGuards(IntegrationHmacGuard)
  @IntegrationPermission('webhooks:read')
  @ApiOperation({ summary: '[Admin] Historial de entregas webhook (últimas 50)' })
  async deliveries(@Query('eventId') eventId?: string) {
    return this.webhookService.deliveryHistory(this.cls.get('tenantId'), eventId);
  }
}