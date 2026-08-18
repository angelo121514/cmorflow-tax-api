// src/database/data-source.ts
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { config } from 'dotenv';
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
} from '../infrastructure/framework/postgres/entities';

config();

const configService = new ConfigService();
const dbHost = configService.get<string>('DB_HOST', 'localhost');
const isProduction = configService.get<string>('NODE_ENV') === 'production';
const useSsl = !(dbHost === 'localhost' || dbHost === '127.0.0.1');

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: dbHost,
  port: configService.get<number>('DB_PORT', 5432),
  username: configService.get<string>('DB_USER', 'postgres'),
  password: configService.get<string>('DB_PASSWORD', 'postgres'),
  database: configService.get<string>('DB_NAME', 'sii_db'),
  schema: configService.get<string>('DB_SCHEMA', 'public'),
  entities: [
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
  ],
  synchronize: false,
  migrations: [__dirname + '/migrations/*.{ts,js}'],
  migrationsTableName: 'typeorm_migrations',
  ssl: useSsl ? { rejectUnauthorized: false } : false,
  logging: isProduction ? ['error'] : ['error', 'warn', 'migration'],
});

export default AppDataSource;