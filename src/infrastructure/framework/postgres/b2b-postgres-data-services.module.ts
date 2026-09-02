// src/infrastructure/framework/postgres/b2b-postgres-data-services.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { IDataServices } from '../../../domain';
import { B2BPostgresDataServices } from './b2b-postgres-data-services.service';
import { CronNonceStore } from './cron-nonce.store';
import {
  IntegrationCredentialEntity,
  IntegrationNonceEntity,
  IntegrationRequestEntity,
  RcofSubmissionEntity,
  IntegrationWebhookEndpointEntity,
  IntegrationWebhookEventEntity,
  IntegrationWebhookDeliveryEntity,
  DteDocumentEntity,
  SiiSubmissionEntity,
  TenantEntity,
  AuditLogEntity,
  TenantConfigEntity,
} from './entities';

const databaseEntities = [
  IntegrationCredentialEntity,
  IntegrationNonceEntity,
  IntegrationRequestEntity,
  RcofSubmissionEntity,
  IntegrationWebhookEndpointEntity,
  IntegrationWebhookEventEntity,
  IntegrationWebhookDeliveryEntity,
  DteDocumentEntity,
  SiiSubmissionEntity,
  TenantEntity,
  AuditLogEntity,
  TenantConfigEntity,
];

@Module({
  imports: [
    TypeOrmModule.forFeature(databaseEntities),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const isProduction = configService.get<string>('NODE_ENV') === 'production';
        const dbHost = configService.get<string>('DB_HOST', 'localhost');
        const isLocalDb = dbHost === 'localhost' || dbHost === '127.0.0.1';

        return {
          type: 'postgres',
          host: dbHost,
          port: configService.get<number>('DB_PORT', 5432),
          username: configService.get<string>('DB_USER', 'postgres'),
          password: configService.get<string>('DB_PASSWORD', 'postgres'),
          database: configService.get<string>('DB_NAME', 'sii_db'),
          schema: configService.get<string>('DB_SCHEMA', 'public'),
          entities: databaseEntities,
          synchronize: !isProduction,
          migrationsRun: false,
          migrations: [__dirname + '/../../../database/migrations/*.{ts,js}'],
          migrationsTableName: 'typeorm_migrations',
          ssl: isLocalDb || configService.get<string>('DB_SSL', 'true') !== 'true'
            ? false
            : { rejectUnauthorized: configService.get<string>('DB_SSL_REJECT_UNAUTHORIZED', 'true') !== 'false' },
          logging: !isProduction ? ['error', 'warn', 'migration'] : ['error'],
        };
      },
    }),
  ],
  providers: [
    { provide: IDataServices, useClass: B2BPostgresDataServices },
    // Nonces anti-replay del cron: necesita el DataSource de forRootAsync,
    // que sólo es visible dentro de este módulo.
    CronNonceStore,
  ],
  exports: [IDataServices, CronNonceStore],
})
export class B2BPostgresDataServicesModule {}
