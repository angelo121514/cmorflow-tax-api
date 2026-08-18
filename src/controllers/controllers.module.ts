// src/controllers/controllers.module.ts
import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../application/integrations/integrations.module';
import { DtesController } from './dtes.controller';
import { RcofController } from './rcof.controller';
import { CredentialsController } from './credentials.controller';
import { WebhooksController } from './webhooks.controller';
import { ArtifactsController } from './artifacts.controller';
import { CronController } from './cron.controller';
import { HealthController } from './health.controller';
import { IntegrationControllerHelper } from './integration-controller.helper';

@Module({
  imports: [IntegrationsModule],
  controllers: [DtesController, RcofController, CredentialsController, WebhooksController, ArtifactsController, CronController, HealthController],
  providers: [IntegrationControllerHelper],
})
export class ControllersModule {}