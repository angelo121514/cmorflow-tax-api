// src/application/dte/dte-emission.module.ts
import { Module } from '@nestjs/common';
import { DataServicesModule } from '../../infrastructure/data-service/data-service.module';
import { SiiModule } from '../../infrastructure/framework/sii/sii.module';
import { EmitDteUseCase } from './emit-dte.use-case';
import { QueryDteStatusUseCase } from './query-dte-status.use-case';

/**
 * Módulo reducido de emisión DTE para la Tax API.
 * Sólo EmitDteUseCase + QueryDteStatusUseCase — sin notas, certificación,
 * intercambio de proveedores ni workers de polling.
 */
@Module({
  imports: [DataServicesModule, SiiModule],
  providers: [EmitDteUseCase, QueryDteStatusUseCase],
  exports: [EmitDteUseCase, QueryDteStatusUseCase],
})
export class DteEmissionModule {}