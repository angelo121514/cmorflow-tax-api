// src/application/dte/dte-emission.module.ts
import { Module } from '@nestjs/common';
import { B2BPostgresDataServicesModule } from '../../infrastructure/framework/postgres/b2b-postgres-data-services.module';
import { SiiModule } from '../../infrastructure/framework/sii/sii.module';
import { EmitDteUseCase } from './emit-dte.use-case';
import { QueryDteStatusUseCase } from './query-dte-status.use-case';

/**
 * Módulo reducido de emisión DTE para la Tax API.
 * Sólo EmitDteUseCase + QueryDteStatusUseCase — sin notas, certificación,
 * intercambio de proveedores ni workers de polling.
 */
@Module({
  imports: [B2BPostgresDataServicesModule, SiiModule],
  providers: [EmitDteUseCase, QueryDteStatusUseCase],
  exports: [EmitDteUseCase, QueryDteStatusUseCase],
})
export class DteEmissionModule {}