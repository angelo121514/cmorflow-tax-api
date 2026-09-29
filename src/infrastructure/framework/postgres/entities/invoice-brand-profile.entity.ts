import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { TenantEntity } from './tenant.entity';
import { IntegrationCredentialEntity } from './integration-credential.entity';

/**
 * Perfil de marca inmutable. Las actualizaciones crean una nueva versión;
 * por eso no tiene columnas de actualización o eliminación lógica.
 */
@Entity('invoice_brand_profiles')
@Index('IDX_invoice_brand_profiles_tenantId', ['tenantId'])
@Index('UQ_invoice_brand_profiles_tenant_version', ['tenantId', 'version'], { unique: true })
@Index('UQ_invoice_brand_profiles_id_tenant', ['id', 'tenantId'], { unique: true })
export class InvoiceBrandProfileEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ type: 'int' })
  version: number;

  @Column({ name: 'logo_data', type: 'bytea', nullable: true })
  logoData: Buffer | null;

  @Column({ name: 'logo_mime_type', type: 'varchar', length: 32, nullable: true })
  logoMimeType: 'image/png' | 'image/jpeg' | null;

  @Column({ name: 'logo_sha256', type: 'varchar', length: 64, nullable: true })
  logoSha256: string | null;

  @Column({ name: 'primary_color', type: 'varchar', length: 7 })
  primaryColor: string;

  @Column({ name: 'secondary_color', type: 'varchar', length: 7 })
  secondaryColor: string;

  @Column({ name: 'created_by_credential_id', type: 'uuid', nullable: true })
  createdByCredentialId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => TenantEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id', foreignKeyConstraintName: 'FK_invoice_brand_profiles_tenant' })
  tenant: TenantEntity;

  @ManyToOne(() => IntegrationCredentialEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({
    name: 'created_by_credential_id',
    foreignKeyConstraintName: 'FK_invoice_brand_profiles_credential',
  })
  createdByCredential: IntegrationCredentialEntity | null;
}
