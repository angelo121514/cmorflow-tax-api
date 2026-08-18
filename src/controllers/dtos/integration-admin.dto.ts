// backend/src/controllers/dtos/integration-admin.dto.ts
import {
  IsNotEmpty,
  IsString,
  IsArray,
  IsOptional,
  IsInt,
  Min,
  IsIn,
  IsBoolean,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { INTEGRATION_PERMISSIONS, INTEGRATION_WEBHOOK_EVENTS } from '../../application/integrations/integration-errors';

export class CreateIntegrationCredentialDto {
  @ApiProperty({ example: 'CMORAPR staging' })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiProperty({ example: 'api', enum: ['api', 'admin'], description: 'Tipo: api (cmor_live_*) para integradores, admin (cmor_admin_*) para gestión' })
  @IsOptional()
  @IsIn(['api', 'admin'])
  credentialType?: 'api' | 'admin';

  @ApiProperty({ example: ['dte:emit', 'dte:read', 'artifacts:read'], enum: INTEGRATION_PERMISSIONS as any })
  @IsNotEmpty()
  @IsArray()
  @IsIn(INTEGRATION_PERMISSIONS as any, { each: true })
  permissions: string[];

  @ApiProperty({ example: 90, required: false, description: 'Expiración en días (opcional)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  expiresInDays?: number;
}

export class RegisterWebhookEndpointDto {
  @ApiProperty({ example: 'https://api.cmorapr.cl/hooks/cmorflow' })
  @IsNotEmpty()
  @IsString()
  url: string;

  @ApiProperty({ example: ['dte.accepted', 'dte.rejected'], enum: INTEGRATION_WEBHOOK_EVENTS as any })
  @IsNotEmpty()
  @IsArray()
  @IsIn(INTEGRATION_WEBHOOK_EVENTS as any, { each: true })
  events: string[];

  @ApiProperty({ example: 'Producción CMORAPR', required: false })
  @IsOptional()
  @IsString()
  description?: string;
}

export class DeactivateWebhookDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  active: boolean;
}
