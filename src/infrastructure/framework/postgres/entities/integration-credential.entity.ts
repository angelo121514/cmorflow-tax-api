import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index, Unique } from 'typeorm';

@Entity('integration_credentials')
@Unique('uq_integration_credentials_key_id', ['keyId'])
@Index('idx_integration_credentials_tenant', ['tenantId'])
export class IntegrationCredentialEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'key_id', type: 'varchar' })
  keyId: string;

  @Column({ name: 'secret_hash', type: 'varchar' })
  secretHash: string;

  @Column({ name: 'secret_last4', type: 'varchar', length: 8 })
  secretLast4: string;

  @Column({ name: 'name', type: 'varchar' })
  name: string;

  @Column({ name: 'credential_type', type: 'varchar', length: 8, default: 'api' })
  credentialType: 'api' | 'admin';

  @Column({ name: 'permissions', type: 'simple-array' })
  permissions: string[];

  @Column({ name: 'status', type: 'varchar', length: 16 })
  status: 'active' | 'revoked';

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt?: Date | null;

  @Column({ name: 'last_used_at', type: 'timestamptz', nullable: true })
  lastUsedAt?: Date | null;

  @Column({ name: 'rotated_from_id', type: 'uuid', nullable: true })
  rotatedFromId?: string | null;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt?: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
