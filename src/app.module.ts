// src/app.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ClsModule } from 'nestjs-cls';
import { APP_INTERCEPTOR, APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { TerminusModule } from '@nestjs/terminus';
import { DataServicesModule } from './infrastructure/data-service/data-service.module';
import { SiiModule } from './infrastructure/framework/sii/sii.module';
import { DteEmissionModule } from './application/dte/dte-emission.module';
import { IntegrationsModule } from './application/integrations/integrations.module';
import { ControllersModule } from './controllers/controllers.module';
import { LoggerModule } from './infrastructure/logger/logger.module';
import { SetTenantContextInterceptor } from './infrastructure/interceptors/set-tenant-context.interceptor';

/**
 * AppModule de CmorFlow Tax API — plataforma tributaria independiente.
 *
 * Sin ERP: sin billing, compliance, AI, accounting, RRHH, POS, productos,
 * inventory, auth/JWT, BullMQ. El tenant se resuelve desde la credencial
 * HMAC (IntegrationHmacGuard), no desde JWT ni headers controlables.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: process.env.SII_ENV_FILE || '.env',
    }),
    ClsModule.forRoot({ global: true, middleware: { mount: true } }),
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60000, limit: 120 }]),
    TerminusModule,
    LoggerModule,
    DataServicesModule,
    SiiModule,
    DteEmissionModule,
    IntegrationsModule,
    ControllersModule,
  ],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: SetTenantContextInterceptor,
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}