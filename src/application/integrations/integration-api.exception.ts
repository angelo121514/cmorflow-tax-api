// backend/src/application/integrations/integration-api.exception.ts
import { HttpException, HttpStatus } from '@nestjs/common';
import { IntegrationErrorCodeValue } from './integration-errors';

/**
 * Excepción de la API B2B con código de error estable del catálogo.
 * Respuesta: { statusCode, error: { code, message } }
 */
export class IntegrationApiException extends HttpException {
  readonly code: IntegrationErrorCodeValue;

  constructor(
    code: IntegrationErrorCodeValue,
    message: string,
    status: HttpStatus,
  ) {
    super({ error: { code, message } }, status);
    this.code = code;
  }
}
