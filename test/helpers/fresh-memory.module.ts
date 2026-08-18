import { Global, Module } from '@nestjs/common';
import { IDataServices } from '../../src/domain';
import { FreshMemoryDataServices } from './fresh-memory-data.service';

/**
 * Módulo @Global de persistencia en memoria para tests y drift check.
 * Al ser global, IDataServices está disponible en todos los módulos sin
 * necesidad de overridear cada referencia individual.
 */
@Global()
@Module({
  providers: [
    FreshMemoryDataServices,
    { provide: IDataServices, useExisting: FreshMemoryDataServices },
  ],
  exports: [IDataServices],
})
export class FreshMemoryModule {}