// backend/src/infrastructure/decorators/integration-permission.decorator.ts
import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ApiExtension } from '@nestjs/swagger';
import { IntegrationPermissionValue } from '../../application/integrations/integration-errors';

export const INTEGRATION_PERMISSIONS_KEY = 'integration_permissions';

/**
 * Permisos B2B exigidos por un endpoint /integrations, validados por
 * IntegrationHmacGuard contra los permisos de la credencial presentada.
 */
export const IntegrationPermission = (...permissions: IntegrationPermissionValue[]) =>
  applyDecorators(
    SetMetadata(INTEGRATION_PERMISSIONS_KEY, permissions),
    ApiExtension('x-auth-type', 'hmac'),
    ApiExtension('x-required-permissions', permissions),
  );
