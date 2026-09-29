import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, DeleteDateColumn, Index, ManyToOne, JoinColumn } from 'typeorm';
import { TenantEntity } from './tenant.entity';
import { InvoiceBrandProfileEntity } from './invoice-brand-profile.entity';

@Entity('dte_documents')
@Index('IDX_dte_documents_tenantId', ['tenantId'])
@Index('UQ_dte_documents_tenant_type_folio', ['tenantId', 'type', 'folio'], { unique: true })
@Index('IDX_dte_documents_tenant_status_created', ['tenantId', 'status', 'createdAt'])
@Index('IDX_dte_documents_brand_profile', ['brandProfileId'])
export class DteDocumentEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ type: 'int' })
  type: number;

  @Column({ type: 'int' })
  folio: number;

  @Column({ name: 'receiver_rut', type: 'varchar', length: 20 })
  receiverRut: string;

  @Column({ name: 'receiver_name', type: 'varchar', length: 255 })
  receiverName: string;

  @Column({ type: 'numeric', precision: 12, scale: 2 })
  amount: number;

  @Column({ name: 'xml_content', type: 'text' })
  xmlContent: string;

  @Column({ name: 'brand_profile_id', type: 'uuid', nullable: true })
  brandProfileId: string | null;

  @Column({ name: 'signature_value', type: 'text', nullable: true })
  signatureValue: string;

  @Column({ type: 'varchar', length: 20, default: 'BORRADOR' })
  status: 'BORRADOR' | 'FIRMADO' | 'ENVIADO' | 'ACEPTADO' | 'RECHAZADO' | 'REPARO' | 'ANULADO';

  @Column({ name: 'track_id', type: 'varchar', length: 100, nullable: true })
  trackId: string;

  @Column({ name: 'status_history', type: 'jsonb', nullable: true })
  statusHistory: Array<{ status: string; timestamp: Date; user: string; detail: string }>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => TenantEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: TenantEntity;

  /**
   * La clave compuesta evita que un DTE de un tenant apunte a la marca de otro.
   * `brand_profile_id` puede ser null para DTE históricos sin personalización.
   */
  @ManyToOne(() => InvoiceBrandProfileEntity, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn([
    {
      name: 'brand_profile_id',
      referencedColumnName: 'id',
      foreignKeyConstraintName: 'FK_dte_documents_brand_profile',
    },
    { name: 'tenant_id', referencedColumnName: 'tenantId' },
  ])
  brandProfile: InvoiceBrandProfileEntity | null;

  @DeleteDateColumn({ name: 'deleted_at', nullable: true })
  deletedAt: Date;
}
