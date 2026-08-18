import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('integration_webhook_deliveries')
@Index('idx_integration_webhook_deliveries_due', ['status', 'nextAttemptAt'])
@Index('idx_integration_webhook_deliveries_event', ['eventId'])
export class IntegrationWebhookDeliveryEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'event_id', type: 'uuid' })
  eventId: string;

  @Column({ name: 'endpoint_id', type: 'uuid' })
  endpointId: string;

  @Column({ name: 'attempt', type: 'integer', default: 0 })
  attempt: number;

  @Column({ name: 'max_attempts', type: 'integer', default: 6 })
  maxAttempts: number;

  @Column({ name: 'status', type: 'varchar', length: 16 })
  status: 'pending' | 'delivering' | 'delivered' | 'failed' | 'dead';

  @Column({ name: 'next_attempt_at', type: 'timestamptz' })
  nextAttemptAt: Date;

  @Column({ name: 'response_status', type: 'integer', nullable: true })
  responseStatus?: number | null;

  @Column({ name: 'response_snippet', type: 'varchar', nullable: true })
  responseSnippet?: string | null;

  @Column({ name: 'last_error', type: 'varchar', nullable: true })
  lastError?: string | null;

  @Column({ name: 'delivered_at', type: 'timestamptz', nullable: true })
  deliveredAt?: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
