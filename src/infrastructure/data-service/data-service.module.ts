// src/infrastructure/data-service/data-service.module.ts
import { Module } from '@nestjs/common';
import { B2BPostgresDataServicesModule } from '../framework/postgres/b2b-postgres-data-services.module';

/**
 * Módulo intermediario que encapsula la implementación de persistencia.
 * Permite que el override en tests (FreshMemoryModule) se propague a todos
 * los módulos que importan DataServicesModule, sin necesidad de overridear
 * cada referencia individual de B2BPostgresDataServicesModule.
 */
@Module({
  imports: [B2BPostgresDataServicesModule],
  exports: [B2BPostgresDataServicesModule],
})
export class DataServicesModule {}