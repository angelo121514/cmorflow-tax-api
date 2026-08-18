import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, DeleteDateColumn, Index, ManyToOne, JoinColumn } from 'typeorm';
import { TenantEntity } from './tenant.entity';

@Entity('sii_submissions')
@Index('IDX_sii_submissions_tenantId', ['tenantId'])
@Index('IDX_sii_submissions_trackId', ['trackId'])
@Index('IDX_sii_submissions_tenant_status', ['tenantId', 'status'])
@Index('UQ_sii_submissions_tenant_idempotency', ['tenantId', 'idempotencyKey'], { unique: true })
export class SiiSubmissionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'track_id', type: 'varchar', length: 100 })
  trackId: string;

  @Column({ type: 'varchar', length: 20, default: 'PENDIENTE' })
  status: 'PENDIENTE' | 'ENVIADO' | 'PROCESADO' | 'RECHAZADO' | 'ERROR';

  @Column({ name: 'response_xml', type: 'text', nullable: true })
  responseXml: string;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string;

  @Column({ name: 'submission_type', type: 'varchar', length: 20, default: 'DTE' })
  submissionType: 'DTE' | 'LIBRO_CV';

  @Column({ name: 'book_operation', type: 'varchar', length: 10, nullable: true })
  bookOperation: 'VENTA' | 'COMPRA' | null;

  @Column({ name: 'tax_period', type: 'varchar', length: 7, nullable: true })
  taxPeriod: string | null;

  @Column({ name: 'book_send_type', type: 'varchar', length: 10, nullable: true })
  bookSendType: 'TOTAL' | 'AJUSTE' | null;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 64, nullable: true })
  idempotencyKey: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => TenantEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: TenantEntity;

  @DeleteDateColumn({ name: 'deleted_at', nullable: true })
  deletedAt: Date;
}
