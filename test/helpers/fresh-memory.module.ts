import { Module } from '@nestjs/common';
import { IDataServices } from '../../src/domain';
import { FreshMemoryDataServices } from './fresh-memory-data.service';

/**
 * Módulo NestJS de persistencia en memoria para tests de la Tax API.
 * Reemplaza B2BPostgresDataServicesModule para que los tests corran sin BD.
 */
@Module({
  providers: [
    FreshMemoryDataServices,
    {
      provide: IDataServices,
      useExisting: FreshMemoryDataServices,
    },
  ],
  exports: [IDataServices],
})
export class FreshMemoryModule {}