import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index, Unique } from 'typeorm';

@Entity('integration_nonces')
@Unique('uq_integration_nonces_credential_nonce', ['credentialId', 'nonce'])
@Index('idx_integration_nonces_expires', ['expiresAt'])
export class IntegrationNonceEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'credential_id', type: 'uuid' })
  credentialId: string;

  @Column({ name: 'nonce', type: 'varchar' })
  nonce: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
