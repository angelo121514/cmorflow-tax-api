import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { QueryFailedError } from 'typeorm';

/**
 * Filtro global de excepciones para CmorFlow Tax API.
 * Transforma toda excepción no manejada en una respuesta JSON uniforme.
 * IntegrationApiException ya incluye { error: { code, message } } en su
 * response, que se respeta aquí.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: any = { error: { code: 'INTERNAL_ERROR', message: 'Error interno del servidor.' } };

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      body = typeof res === 'object' ? res : { error: { code: 'HTTP_ERROR', message: res } };
    } else if (exception instanceof QueryFailedError) {
      const msg = (exception as any).message || '';
      if (msg.includes('23505')) {
        status = HttpStatus.CONFLICT;
        body = { error: { code: 'DUPLICATE', message: 'Conflicto de unicidad en la base de datos.' } };
      } else {
        status = HttpStatus.BAD_REQUEST;
        body = { error: { code: 'DB_ERROR', message: 'Error de base de datos.' } };
      }
      this.logger.error(`QueryFailedError: ${msg}`);
    } else if (exception instanceof Error) {
      this.logger.error(`Unhandled error: ${exception.message}`, exception.stack);
    }

    response.status(status).json({
      statusCode: status,
      ...body,
    });
  }
}