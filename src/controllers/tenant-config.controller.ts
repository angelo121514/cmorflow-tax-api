import { Body, Controller, Get, NotFoundException, Post, Put, Res, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import { ClsService } from 'nestjs-cls';
import { Response } from 'express';
import { Public } from '../infrastructure/decorators/public.decorator';
import { IntegrationHmacGuard } from '../infrastructure/guards/integration-hmac.guard';
import { IntegrationPermission } from '../infrastructure/decorators/integration-permission.decorator';
import { TenantConfigService } from '../infrastructure/framework/sii/tenant-config.service';
import { InvoiceBrandingService } from '../infrastructure/framework/sii/invoice-branding.service';
import {
  InvoiceBrandingMetadataDto,
  SaveSignatureDto,
  UpdateInvoiceBrandingDto,
  UploadCafDto,
} from './dtos/tenant-config.dto';

@ApiTags('configuration')
@Controller('configuration')
export class TenantConfigController {
  constructor(
    private readonly cls: ClsService,
    private readonly tenantConfig: TenantConfigService,
    private readonly branding: InvoiceBrandingService,
  ) {}

  @Post('caf')
  @Public()
  @UseGuards(IntegrationHmacGuard)
  @IntegrationPermission('credentials:write')
  @ApiOperation({ summary: '[Admin] Cargar XML CAF completo del SII' })
  uploadCaf(@Body() dto: UploadCafDto) {
    return this.tenantConfig.uploadCaf(this.cls.get('tenantId'), dto.cafXml);
  }

  @Post('signature')
  @Public()
  @UseGuards(IntegrationHmacGuard)
  @IntegrationPermission('credentials:write')
  @ApiOperation({ summary: '[Admin] Guardar certificado digital PFX cifrado' })
  saveSignature(@Body() dto: SaveSignatureDto) {
    return this.tenantConfig.saveSignature(this.cls.get('tenantId'), dto.pfxBase64, dto.password);
  }

  @Get('folios')
  @Public()
  @UseGuards(IntegrationHmacGuard)
  @IntegrationPermission('credentials:read')
  @ApiOperation({ summary: '[Admin] Consultar stock y estado de folios CAF' })
  getFolios() {
    return this.tenantConfig.getFolioStatus(this.cls.get('tenantId'));
  }

  @Get('branding')
  @Public()
  @UseGuards(IntegrationHmacGuard)
  @IntegrationPermission('credentials:read')
  @ApiOperation({ summary: '[Admin] Consultar la versión visual activa de facturas' })
  @ApiOkResponse({ description: 'Metadatos de la versión visual actualmente activa.', type: InvoiceBrandingMetadataDto })
  getBranding() {
    return this.branding.getActiveBranding(this.cls.get('tenantId'));
  }

  @Put('branding')
  @Public()
  @UseGuards(IntegrationHmacGuard)
  @IntegrationPermission('credentials:write')
  @ApiOperation({ summary: '[Admin] Crear y activar una nueva versión visual de facturas' })
  @ApiOkResponse({ description: 'Metadatos de la nueva versión visual activada.', type: InvoiceBrandingMetadataDto })
  updateBranding(@Body() dto: UpdateInvoiceBrandingDto) {
    return this.branding.update(
      this.cls.get('tenantId'),
      dto,
      this.cls.get('credentialId'),
    );
  }

  @Get('branding/logo')
  @Public()
  @UseGuards(IntegrationHmacGuard)
  @IntegrationPermission('credentials:read')
  @ApiOperation({ summary: '[Admin] Descargar el logo de la versión visual activa' })
  @ApiProduces('image/png')
  @ApiOkResponse({
    description: 'PNG normalizado de la versión visual activa.',
    content: { 'image/png': { schema: { type: 'string', format: 'binary' } } },
  })
  async getBrandingLogo(@Res() res: Response) {
    const logo = await this.branding.getActiveLogo(this.cls.get('tenantId'));
    if (!logo) throw new NotFoundException('La versión visual activa no tiene logo configurado.');
    res.set({
      'Content-Type': logo.mimeType,
      'Content-Length': String(logo.data.length),
      'Cache-Control': 'private, no-store',
    });
    res.end(logo.data);
  }
}
