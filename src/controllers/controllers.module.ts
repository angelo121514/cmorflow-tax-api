// src/controllers/controllers.module.ts
import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../application/integrations/integrations.module';
import { DataServicesModule } from '../infrastructure/data-service/data-service.module';
import { DtesController } from './dtes.controller';
import { RcofController } from './rcof.controller';
import { CredentialsController } from './credentials.controller';
import { WebhooksController } from './webhooks.controller';
import { ArtifactsController } from './artifacts.controller';
import { CronController } from './cron.controller';
import { HealthController } from './health.controller';
import { IntegrationControllerHelper } from './integration-controller.helper';
import { CronHmacGuard } from '../infrastructure/guards/cron-hmac.guard';
import { LoggerModule } from '../infrastructure/logger/logger.module';
import { MetricsController } from './metrics.controller';
import { TenantConfigController } from './tenant-config.controller';
import { SiiModule } from '../infrastructure/framework/sii/sii.module';
import { Aes256Cipher } from '../infrastructure/framework/crypto/aes-256-cipher';

@Module({
// DataServicesModule hace visible IDataServices para IntegrationHmacGuard:
// Nest instancia los guards (@UseGuards) en el contexto del módulo del
// controlador, no en IntegrationsModule donde el guard está registrado.
  imports: [IntegrationsModule, DataServicesModule, LoggerModule, SiiModule],
  controllers: [DtesController, RcofController, CredentialsController, WebhooksController, ArtifactsController, CronController, HealthController, MetricsController, TenantConfigController],
  providers: [IntegrationControllerHelper, CronHmacGuard, Aes256Cipher],
})
export class ControllersModule {}
