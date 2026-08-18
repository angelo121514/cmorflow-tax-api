import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, DeleteDateColumn } from 'typeorm';

@Entity('tenants')
export class TenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 12, unique: true })
  rut: string;

  @Column({ length: 255, name: 'business_name' })
  businessName: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ name: 'trial_ends_at', type: 'timestamptz', nullable: true })
  trialEndsAt: Date;

  @Column({ name: 'plan_id', type: 'varchar', nullable: true })
  planId: string | null;

  @Column({ name: 'gdpr_deleted_at', type: 'timestamptz', nullable: true })
  gdprDeletedAt: Date | null;

  @Column({ name: 'data_retention_until', type: 'timestamptz', nullable: true })
  dataRetentionUntil: Date | null;

  @Column({ name: 'billing_email', type: 'varchar', nullable: true })
  billingEmail: string | null;

  @DeleteDateColumn({ name: 'deleted_at', nullable: true })
  deletedAt: Date;
}
