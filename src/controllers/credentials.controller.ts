// src/controllers/credentials.controller.ts
import { Controller, Get, Post, Body, Param, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ClsService } from 'nestjs-cls';
import { Public } from '../infrastructure/decorators/public.decorator';
import { IntegrationHmacGuard } from '../infrastructure/guards/integration-hmac.guard';
import { IntegrationPermission } from '../infrastructure/decorators/integration-permission.decorator';
import { IntegrationCredentialsUseCase } from '../application/integrations/integration-credentials.use-case';
import { CreateIntegrationCredentialDto } from './dtos/integration-admin.dto';

@ApiTags('credentials')
@Controller('credentials')
export class CredentialsController {
  constructor(
    private readonly cls: ClsService,
    private readonly credentialsUseCase: IntegrationCredentialsUseCase,
  ) {}

  @Post()
  @Public()
  @UseGuards(IntegrationHmacGuard)
  @IntegrationPermission('credentials:write')
  @ApiOperation({ summary: '[Admin] Crear credencial — el secreto se muestra UNA sola vez' })
  @ApiResponse({ status: 201, description: 'Credencial creada con secreto inicial.' })
  async create(@Body() dto: CreateIntegrationCredentialDto) {
    const tenantId = this.cls.get('tenantId');
    return this.credentialsUseCase.create(tenantId, {
      name: dto.name,
      credentialType: dto.credentialType ?? 'api',
      permissions: dto.permissions as any,
      expiresInDays: dto.expiresInDays,
    });
  }

  @Get()
  @Public()
  @UseGuards(IntegrationHmacGuard)
  @IntegrationPermission('credentials:read')
  @ApiOperation({ summary: '[Admin] Listar credenciales (enmascaradas)' })
  async list() {
    return this.credentialsUseCase.list(this.cls.get('tenantId'));
  }

  @Post(':id/rotate')
  @Public()
  @UseGuards(IntegrationHmacGuard)
  @IntegrationPermission('credentials:write')
  @ApiOperation({ summary: '[Admin] Rotar credencial — la antigua vive 24h de gracia' })
  async rotate(@Param('id') id: string) {
    return this.credentialsUseCase.rotate(this.cls.get('tenantId'), id);
  }

  @Post(':id/revoke')
  @Public()
  @UseGuards(IntegrationHmacGuard)
  @IntegrationPermission('credentials:write')
  @ApiOperation({ summary: '[Admin] Revocar credencial inmediatamente' })
  async revoke(@Param('id') id: string, @Req() request: any) {
    return this.credentialsUseCase.revoke(this.cls.get('tenantId'), id, {
      actorCredentialId: request.integrationCredential?.id,
    });
  }
}