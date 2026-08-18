// src/infrastructure/framework/postgres/b2b-postgres-data-services.service.ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClsService } from 'nestjs-cls';
import {
  IDataServices,
  IntegrationCredentialEntity as DomainIntegrationCredentialEntity,
  IntegrationNonceEntity as DomainIntegrationNonceEntity,
  IntegrationRequestEntity as DomainIntegrationRequestEntity,
  RcofSubmissionEntity as DomainRcofSubmissionEntity,
  IntegrationWebhookEndpointEntity as DomainIntegrationWebhookEndpointEntity,
  IntegrationWebhookEventEntity as DomainIntegrationWebhookEventEntity,
  IntegrationWebhookDeliveryEntity as DomainIntegrationWebhookDeliveryEntity,
  DteDocumentEntity as DomainDteDocumentEntity,
  SiiSubmissionEntity as DomainSiiSubmissionEntity,
  TenantEntity as DomainTenantEntity,
  AuditLogEntity as DomainAuditLogEntity,
} from '../../../domain';
import { PostgresGenericRepository } from './postgres-generic-repository';
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
} from './entities';

/**
 * Implementación reducida de IDataServices para la Tax API.
 * Sólo 11 repositorios (7 B2B + 4 del motor DTE compartido).
 * credentials y nonces son lookup global (isTenantScoped=false); el resto
 * es tenant-scoped con fail-closed vía PostgresGenericRepository.
 */
@Injectable()
export class B2BPostgresDataServices implements IDataServices, OnModuleInit {
  integrationCredential!: PostgresGenericRepository<DomainIntegrationCredentialEntity>;
  integrationNonce!: PostgresGenericRepository<DomainIntegrationNonceEntity>;
  integrationRequest!: PostgresGenericRepository<DomainIntegrationRequestEntity>;
  rcofSubmission!: PostgresGenericRepository<DomainRcofSubmissionEntity>;
  integrationWebhookEndpoint!: PostgresGenericRepository<DomainIntegrationWebhookEndpointEntity>;
  integrationWebhookEvent!: PostgresGenericRepository<DomainIntegrationWebhookEventEntity>;
  integrationWebhookDelivery!: PostgresGenericRepository<DomainIntegrationWebhookDeliveryEntity>;
  dteDocument!: PostgresGenericRepository<DomainDteDocumentEntity>;
  siiSubmission!: PostgresGenericRepository<DomainSiiSubmissionEntity>;
  tenant!: PostgresGenericRepository<DomainTenantEntity>;
  auditLog!: PostgresGenericRepository<DomainAuditLogEntity>;

  constructor(
    @InjectRepository(IntegrationCredentialEntity)
    private readonly integrationCredentialRepository: Repository<IntegrationCredentialEntity>,
    @InjectRepository(IntegrationNonceEntity)
    private readonly integrationNonceRepository: Repository<IntegrationNonceEntity>,
    @InjectRepository(IntegrationRequestEntity)
    private readonly integrationRequestRepository: Repository<IntegrationRequestEntity>,
    @InjectRepository(RcofSubmissionEntity)
    private readonly rcofSubmissionRepository: Repository<RcofSubmissionEntity>,
    @InjectRepository(IntegrationWebhookEndpointEntity)
    private readonly integrationWebhookEndpointRepository: Repository<IntegrationWebhookEndpointEntity>,
    @InjectRepository(IntegrationWebhookEventEntity)
    private readonly integrationWebhookEventRepository: Repository<IntegrationWebhookEventEntity>,
    @InjectRepository(IntegrationWebhookDeliveryEntity)
    private readonly integrationWebhookDeliveryRepository: Repository<IntegrationWebhookDeliveryEntity>,
    @InjectRepository(DteDocumentEntity)
    private readonly dteDocumentRepository: Repository<DteDocumentEntity>,
    @InjectRepository(SiiSubmissionEntity)
    private readonly siiSubmissionRepository: Repository<SiiSubmissionEntity>,
    @InjectRepository(TenantEntity)
    private readonly tenantRepository: Repository<TenantEntity>,
    @InjectRepository(AuditLogEntity)
    private readonly auditLogRepository: Repository<AuditLogEntity>,
    private readonly cls: ClsService,
  ) {}

  onModuleInit() {
    // Lookup global: el guard resuelve el tenant desde la credencial.
    this.integrationCredential = new PostgresGenericRepository(
      this.integrationCredentialRepository, this.cls, false,
    );
    this.integrationNonce = new PostgresGenericRepository(
      this.integrationNonceRepository, this.cls, false,
    );
    // Tenant-scoped (fail-closed).
    this.integrationRequest = new PostgresGenericRepository(
      this.integrationRequestRepository, this.cls, true,
    );
    this.rcofSubmission = new PostgresGenericRepository(
      this.rcofSubmissionRepository, this.cls, true,
    );
    this.integrationWebhookEndpoint = new PostgresGenericRepository(
      this.integrationWebhookEndpointRepository, this.cls, true,
    );
    this.integrationWebhookEvent = new PostgresGenericRepository(
      this.integrationWebhookEventRepository, this.cls, true,
    );
    this.integrationWebhookDelivery = new PostgresGenericRepository(
      this.integrationWebhookDeliveryRepository, this.cls, true,
    );
    this.dteDocument = new PostgresGenericRepository(
      this.dteDocumentRepository, this.cls, true,
    );
    this.siiSubmission = new PostgresGenericRepository(
      this.siiSubmissionRepository, this.cls, true,
    );
    this.tenant = new PostgresGenericRepository(
      this.tenantRepository, this.cls, false,
    );
    this.auditLog = new PostgresGenericRepository(
      this.auditLogRepository, this.cls, true,
    );
  }
}