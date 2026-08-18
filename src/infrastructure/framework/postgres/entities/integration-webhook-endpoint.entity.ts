import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('integration_webhook_endpoints')
@Index('idx_integration_webhook_endpoints_tenant', ['tenantId'])
export class IntegrationWebhookEndpointEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'url', type: 'varchar' })
  url: string;

  @Column({ name: 'secret_cipher', type: 'text' })
  secretCipher: string;

  @Column({ name: 'secret_last4', type: 'varchar', length: 8 })
  secretLast4: string;

  @Column({ name: 'events', type: 'simple-array' })
  events: string[];

  @Column({ name: 'active', type: 'boolean', default: true })
  active: boolean;

  @Column({ name: 'description', type: 'varchar', nullable: true })
  description?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
