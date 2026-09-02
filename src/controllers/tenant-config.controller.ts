import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClsService } from 'nestjs-cls';
import { Public } from '../infrastructure/decorators/public.decorator';
import { IntegrationHmacGuard } from '../infrastructure/guards/integration-hmac.guard';
import { IntegrationPermission } from '../infrastructure/decorators/integration-permission.decorator';
import { TenantConfigService } from '../infrastructure/framework/sii/tenant-config.service';
import { UploadCafDto, SaveSignatureDto } from './dtos/tenant-config.dto';

@ApiTags('configuration')
@Controller('configuration')
export class TenantConfigController {
  constructor(private readonly cls: ClsService, private readonly tenantConfig: TenantConfigService) {}

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
}
