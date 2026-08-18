import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('integration_webhook_events')
@Index('idx_integration_webhook_events_tenant', ['tenantId'])
@Index('idx_integration_webhook_events_request', ['requestId'])
export class IntegrationWebhookEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'type', type: 'varchar' })
  type: string;

  @Column({ name: 'request_id', type: 'uuid', nullable: true })
  requestId?: string | null;

  @Column({ name: 'rcof_id', type: 'uuid', nullable: true })
  rcofId?: string | null;

  @Column({ name: 'payload', type: 'jsonb' })
  payload: any;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
