import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index, Unique } from 'typeorm';

@Entity('rcof_submissions')
@Unique('uq_rcof_submissions_tenant_period_seq', ['tenantId', 'periodDate', 'sequence'])
@Index('idx_rcof_submissions_status', ['status'])
export class RcofSubmissionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'period_date', type: 'date' })
  periodDate: string;

  @Column({ name: 'sequence', type: 'integer' })
  sequence: number;

  @Column({ name: 'xml_content', type: 'text' })
  xmlContent: string;

  @Column({ name: 'track_id', type: 'varchar', nullable: true })
  trackId?: string | null;

  @Column({ name: 'status', type: 'varchar', length: 16 })
  status: 'submitted' | 'accepted' | 'observed' | 'rejected' | 'failed';

  @Column({ name: 'sii_response', type: 'jsonb', nullable: true })
  siiResponse?: any;

  @CreateDateColumn({ name: 'created_at' })
  createdAt?: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt?: Date;
}
