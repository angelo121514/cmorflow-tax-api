// src/domain/abstracts/data-services.abstract.ts
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
} from '../entities';
import { IGenericRepository } from './generic-repository.abstract';

/**
 * Interfaz reducida de persistencia para la Tax API.
 * Sólo los 11 repositorios que el motor tributario + integrations usan.
 * tenant-config se gestiona vía repositorio TypeORM directo en SiiModule.
 */
export abstract class IDataServices {
  abstract integrationCredential: IGenericRepository<IntegrationCredentialEntity>;
  abstract integrationNonce: IGenericRepository<IntegrationNonceEntity>;
  abstract integrationRequest: IGenericRepository<IntegrationRequestEntity>;
  abstract rcofSubmission: IGenericRepository<RcofSubmissionEntity>;
  abstract integrationWebhookEndpoint: IGenericRepository<IntegrationWebhookEndpointEntity>;
  abstract integrationWebhookEvent: IGenericRepository<IntegrationWebhookEventEntity>;
  abstract integrationWebhookDelivery: IGenericRepository<IntegrationWebhookDeliveryEntity>;
  abstract dteDocument: IGenericRepository<DteDocumentEntity>;
  abstract siiSubmission: IGenericRepository<SiiSubmissionEntity>;
  abstract tenant: IGenericRepository<TenantEntity>;
  abstract auditLog: IGenericRepository<AuditLogEntity>;
}