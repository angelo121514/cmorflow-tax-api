import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, DeleteDateColumn, Index, ManyToOne, JoinColumn } from 'typeorm';
import { TenantEntity } from './tenant.entity';

@Entity('audit_logs')
@Index('IDX_audit_logs_tenantId', ['tenantId'])
@Index('IDX_audit_logs_tenant_action_created', ['tenantId', 'action', 'createdAt'])
@Index('IDX_audit_logs_userId', ['userId'])
export class AuditLogEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string;

  @Column()
  action: string;

  @Column({ name: 'ip_address', nullable: true })
  ipAddress: string;

  @Column({ name: 'user_agent', type: 'text', nullable: true })
  userAgent: string;

  @Column({ type: 'jsonb', nullable: true })
  payload: any;

  @Column({ name: 'prev_hash', type: 'varchar', nullable: true })
  prevHash: string | null;

  @Column({ type: 'varchar', nullable: true })
  hash: string | null;

  @Column({ type: 'bigint', nullable: true })
  sequence: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => TenantEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: TenantEntity;

  @DeleteDateColumn({ name: 'deleted_at', nullable: true })
  deletedAt: Date;

  
}
