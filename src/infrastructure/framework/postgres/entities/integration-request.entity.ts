import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index, Unique } from 'typeorm';

@Entity('integration_requests')
@Unique('uq_integration_requests_tenant_key', ['tenantId', 'idempotencyKey'])
@Unique('uq_integration_requests_tenant_extref', ['tenantId', 'externalReference'])
@Index('idx_integration_requests_state_next_attempt', ['state', 'nextAttemptAt'])
@Index('idx_integration_requests_tenant_state', ['tenantId', 'state'])
@Index('idx_integration_requests_dte', ['dteId'])
export class IntegrationRequestEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'kind', type: 'varchar', length: 16 })
  kind: 'dte' | 'credit-note' | 'debit-note' | 'rcof';

  @Column({ name: 'idempotency_key', type: 'varchar' })
  idempotencyKey: string;

  @Column({ name: 'request_hash', type: 'varchar' })
  requestHash: string;

  @Column({ name: 'external_reference', type: 'varchar', nullable: true })
  externalReference?: string | null;

  @Column({ name: 'payload', type: 'jsonb' })
  payload: any;

  @Column({ name: 'metadata', type: 'jsonb', nullable: true })
  metadata?: any;

  @Column({ name: 'state', type: 'varchar', length: 16 })
  state:
    | 'queued'
    | 'processing'
    | 'submitted'
    | 'accepted'
    | 'observed'
    | 'rejected'
    | 'failed'
    | 'cancelled';

  @Column({ name: 'dte_id', type: 'uuid', nullable: true })
  dteId?: string | null;

  @Column({ name: 'rcof_id', type: 'uuid', nullable: true })
  rcofId?: string | null;

  @Column({ name: 'origin_credential_id', type: 'uuid' })
  originCredentialId: string;

  @Column({ name: 'attempts', type: 'integer', default: 0 })
  attempts: number;

  @Column({ name: 'max_attempts', type: 'integer', default: 5 })
  maxAttempts: number;

  @Column({ name: 'next_attempt_at', type: 'timestamptz' })
  nextAttemptAt: Date;

  @Column({ name: 'locked_at', type: 'timestamptz', nullable: true })
  lockedAt?: Date | null;

  @Column({ name: 'last_error', type: 'jsonb', nullable: true })
  lastError?: any;

  @Column({ name: 'state_history', type: 'jsonb', default: '[]' })
  stateHistory: any[];

  @Column({ name: 'response_snapshot', type: 'jsonb', nullable: true })
  responseSnapshot?: any;

  @Column({ name: 'submitted_at', type: 'timestamptz', nullable: true })
  submittedAt?: Date | null;

  @Column({ name: 'finalized_at', type: 'timestamptz', nullable: true })
  finalizedAt?: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt?: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt?: Date;
}
