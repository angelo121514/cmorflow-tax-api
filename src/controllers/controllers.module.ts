// src/controllers/controllers.module.ts
import { Module } from '@nestjs/common';
import { IntegrationsController } from './integrations.controller';
import { HealthController } from './health.controller';
import { IntegrationsModule } from '../application/integrations/integrations.module';

@Module({
  imports: [IntegrationsModule],
  controllers: [IntegrationsController, HealthController],
})
export class ControllersModule {}