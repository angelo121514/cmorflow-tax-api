// backend/src/application/integrations/integrations.module.ts
import { Module } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { B2BPostgresDataServicesModule } from '../../infrastructure/framework/postgres/b2b-postgres-data-services.module';
import { SiiModule } from '../../infrastructure/framework/sii/sii.module';
import { DteEmissionModule } from '../dte/dte-emission.module';
import { Aes256Cipher } from '../../infrastructure/framework/crypto/aes-256-cipher';
import { IntegrationCredentialsUseCase } from './integration-credentials.use-case';
import { IntegrationRequestService } from './integration-request.service';
import { IntegrationStateService, INTEGRATION_EVENT_DISPATCHER } from './integration-state.service';
import { IntegrationQueueClaimer } from './integration-queue.claimer';
import { IntegrationProcessorService } from './integration-processor.service';
import { IntegrationArtifactsService } from './integration-artifacts.service';
import { IntegrationWebhookService } from './integration-webhook.service';
import { IntegrationOrchestratorService } from './integration-orchestrator.service';
import { GenerateRcofUseCase } from './generate-rcof.use-case';
import { IntegrationHmacGuard } from '../../infrastructure/guards/integration-hmac.guard';
import { IntegrationJobPort } from './integration-job.port';

/**
 * API B2B /integrations: credenciales HMAC, cola asíncrona sobre Postgres,
 * webhooks salientes firmados y RCOF persistido/transmitido.
 */
@Module({
  imports: [B2BPostgresDataServicesModule, SiiModule, DteEmissionModule],
  providers: [
    Aes256Cipher,
    IntegrationCredentialsUseCase,
    IntegrationRequestService,
    IntegrationStateService,
    IntegrationQueueClaimer,
    IntegrationProcessorService,
    IntegrationArtifactsService,
    IntegrationWebhookService,
    IntegrationOrchestratorService,
    GenerateRcofUseCase,
    IntegrationHmacGuard,
    {
      // Las transiciones de estado disparan webhooks sin dependencia circular.
      provide: INTEGRATION_EVENT_DISPATCHER,
      useExisting: IntegrationWebhookService,
    },
    {
      // El worker es intercambiable vía este puerto (cron hoy, BullMQ mañana).
      provide: 'INTEGRATION_JOB_PORT',
      useExisting: IntegrationOrchestratorService,
    },
  ],
  exports: [
    IntegrationCredentialsUseCase,
    IntegrationRequestService,
    IntegrationStateService,
    IntegrationProcessorService,
    IntegrationArtifactsService,
    IntegrationWebhookService,
    IntegrationOrchestratorService,
    GenerateRcofUseCase,
    IntegrationHmacGuard,
  ],
})
export class IntegrationsModule {}



