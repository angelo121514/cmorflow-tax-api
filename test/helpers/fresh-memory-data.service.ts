import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  IDataServices,
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
} from '../../src/domain';
import { MemoryGenericRepository } from '../../src/infrastructure/framework/memory/memory-generic-repository';

@Injectable()
export class FreshMemoryDataServices implements IDataServices, OnModuleInit {
  integrationCredential!: MemoryGenericRepository<IntegrationCredentialEntity>;
  integrationNonce!: MemoryGenericRepository<IntegrationNonceEntity>;
  integrationRequest!: MemoryGenericRepository<IntegrationRequestEntity>;
  rcofSubmission!: MemoryGenericRepository<RcofSubmissionEntity>;
  integrationWebhookEndpoint!: MemoryGenericRepository<IntegrationWebhookEndpointEntity>;
  integrationWebhookEvent!: MemoryGenericRepository<IntegrationWebhookEventEntity>;
  integrationWebhookDelivery!: MemoryGenericRepository<IntegrationWebhookDeliveryEntity>;
  dteDocument!: MemoryGenericRepository<DteDocumentEntity>;
  siiSubmission!: MemoryGenericRepository<SiiSubmissionEntity>;
  tenant!: MemoryGenericRepository<TenantEntity>;
  auditLog!: MemoryGenericRepository<AuditLogEntity>;

  onModuleInit(): void {
    this.integrationCredential = new MemoryGenericRepository();
    this.integrationNonce = new MemoryGenericRepository();
    this.integrationRequest = new MemoryGenericRepository();
    this.rcofSubmission = new MemoryGenericRepository();
    this.integrationWebhookEndpoint = new MemoryGenericRepository();
    this.integrationWebhookEvent = new MemoryGenericRepository();
    this.integrationWebhookDelivery = new MemoryGenericRepository();
    this.dteDocument = new MemoryGenericRepository();
    this.siiSubmission = new MemoryGenericRepository();
    this.tenant = new MemoryGenericRepository();
    this.auditLog = new MemoryGenericRepository();
  }
}
