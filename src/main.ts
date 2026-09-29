// src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { assertCompleteOpenApiContract, completeOpenApiContract } from './infrastructure/swagger/api-contract';
import { GlobalExceptionFilter } from './infrastructure/filters/global-exception.filter';
import { NestExpressApplication } from '@nestjs/platform-express';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger as WinstonLogger } from 'winston';
import helmet from 'helmet';
import { json, urlencoded } from 'express';
import { validateRuntimeConfig } from './infrastructure/config/runtime-config';

async function bootstrap() {
  validateRuntimeConfig();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
    bodyParser: false,
  });

  const winstonLogger = app.get(WINSTON_MODULE_PROVIDER);
  app.useLogger({
    log: (message: string, context?: string) => winstonLogger.info(message, { context: context || 'App' }),
    error: (message: string, trace?: string, context?: string) => winstonLogger.error(message, { trace, context: context || 'App' }),
    warn: (message: string, context?: string) => winstonLogger.warn(message, { context: context || 'App' }),
    debug: (message: string, context?: string) => winstonLogger.debug(message, { context: context || 'App' }),
    verbose: (message: string, context?: string) => winstonLogger.verbose(message, { context: context || 'App' }),
  });

  const bodyLimit = process.env.HTTP_BODY_LIMIT || '1mb';
  app.use(json({ limit: bodyLimit, verify: (req: any, _res, buffer) => { req.rawBody = buffer; } }));
  app.use(urlencoded({ limit: bodyLimit, extended: false }));
  // Render termina TLS en 1 hop: sin esto, req.ip es la IP del proxy y el
  // Throttler global colapsa en un único bucket para todos los clientes.
  app.set('trust proxy', 1);
  const docsEnabled = process.env.API_DOCS_ENABLED === 'true' || process.env.NODE_ENV !== 'production';
  // CSP se desactiva sólo cuando se sirve Swagger UI (requiere inline scripts).
  app.use(helmet(docsEnabled ? { contentSecurityPolicy: false } : {}));
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new GlobalExceptionFilter());

  const corsOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
    : [];
  app.enableCors({
    origin: (origin, callback) => {
      // Sin Origin (B2B server-to-server) u origen permitido → con headers CORS.
      // Origen desconocido → respuesta SIN headers CORS (el navegador la bloquea),
      // en vez de un 500 que ensucia logs y métricas.
      if (!origin || corsOrigins.includes(origin)) callback(null, true);
      else callback(null, false);
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
    .addTag('configuration', 'Configuración tributaria y visual (admin)')
    .addTag('health', 'Health checks')
    .build();

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
      await app.close();
      throw migErr;
    }
  }

  if (docsEnabled) {
    const document = completeOpenApiContract(SwaggerModule.createDocument(app, swaggerConfig));
    assertCompleteOpenApiContract(document);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: { persistAuthorization: process.env.NODE_ENV !== 'production' },
      customSiteTitle: 'CmorFlow Tax API — Docs',
    });
  }

  await app.listen(port);
  winstonLogger.info(`CmorFlow Tax API iniciada en http://localhost:${port}/api/v1`, { context: 'Bootstrap' });
  if (docsEnabled) winstonLogger.info(`Swagger: http://localhost:${port}/api/docs`, { context: 'Bootstrap' });
}
bootstrap().catch((error) => {
  // Fail closed: an invalid configuration or migration must never accept traffic.
  console.error(`No se pudo iniciar CmorFlow Tax API: ${(error as Error).message}`);
  process.exit(1);
});
