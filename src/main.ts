// src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { GlobalExceptionFilter } from './infrastructure/filters/global-exception.filter';
import { NestExpressApplication } from '@nestjs/platform-express';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger as WinstonLogger } from 'winston';
import helmet from 'helmet';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });

  const winstonLogger = app.get(WINSTON_MODULE_PROVIDER);
  app.useLogger({
    log: (message: string, context?: string) => winstonLogger.info(message, { context: context || 'App' }),
    error: (message: string, trace?: string, context?: string) => winstonLogger.error(message, { trace, context: context || 'App' }),
    warn: (message: string, context?: string) => winstonLogger.warn(message, { context: context || 'App' }),
    debug: (message: string, context?: string) => winstonLogger.debug(message, { context: context || 'App' }),
    verbose: (message: string, context?: string) => winstonLogger.verbose(message, { context: context || 'App' }),
  });

  app.use(helmet({ contentSecurityPolicy: false }));
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new GlobalExceptionFilter());

  const corsOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
    : [];
  app.enableCors({
    origin: (origin, callback) => {
      if (!origin || corsOrigins.includes(origin)) callback(null, true);
      else callback(new Error(`CORS no permitido para el origen: ${origin}`));
    },
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
  });

  const port = process.env.PORT || 3000;

  const swaggerConfig = new DocumentBuilder()
    .setTitle('CmorFlow Tax API')
    .setDescription(
      'Plataforma tributaria B2B para facturación electrónica chilena vía API. ' +
      'Emisión asíncrona de DTE, RCOF, webhooks y artefactos XML/PDF. ' +
      'Autenticación HMAC por credencial ligada a un único tenant.',
    )
    .setVersion('1.0')
    .addApiKey(
      {
        type: 'apiKey',
        in: 'header',
        name: 'X-Api-Key',
        description:
          'Autenticación HMAC. Requiere X-Timestamp, X-Nonce y X-Signature. ' +
          'Credenciales API: cmor_live_*, admin: cmor_admin_*.',
      },
      'integration-hmac',
    )
    .addTag('dtes', 'Emisión y consulta de DTE')
    .addTag('rcof', 'Consumo de folios (RCOF)')
    .addTag('credentials', 'Gestión de credenciales (admin)')
    .addTag('webhooks', 'Gestión de webhooks (admin)')
    .addTag('health', 'Health checks')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
    customSiteTitle: 'CmorFlow Tax API — Docs',
  });

  await app.listen(port);
  winstonLogger.info(`CmorFlow Tax API iniciada en http://localhost:${port}/api/v1`, { context: 'Bootstrap' });
  winstonLogger.info(`Swagger: http://localhost:${port}/api/docs`, { context: 'Bootstrap' });

  if (process.env.AUTO_RUN_MIGRATIONS === 'true') {
    try {
      const dataSource = app.get('DataSource');
      const pending = await dataSource.showMigrations();
      if (pending) {
        winstonLogger.info('Ejecutando migraciones pendientes...', { context: 'Bootstrap' });
        await dataSource.runMigrations();
        winstonLogger.info('Migraciones OK', { context: 'Bootstrap' });
      }
    } catch (migErr) {
      winstonLogger.error(`Error en migraciones: ${(migErr as Error).message}`, { context: 'Bootstrap' });
    }
  }
}
bootstrap();