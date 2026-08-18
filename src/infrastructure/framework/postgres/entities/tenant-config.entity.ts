import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

/**
 * Entidad para almacenar la configuración de cada tenant en la base de datos.
 * Incluye la firma digital PFX (cifrada con AES-256-GCM) y los archivos CAF
 * parseados, todo almacenado como JSONB para flexibilidad y consultas nativas.
 *
 * Reemplaza el almacenamiento en filesystem local (storage/tenants/{id}/config.json)
 * que era efímero en plataformas como Render.
 */
@Entity('tenant_configs')
export class TenantConfigEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid', unique: true })
  tenantId: string;

  @Column({ name: 'config_json', type: 'jsonb', default: {} })
  configJson: Record<string, any>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', nullable: true })
  deletedAt: Date;
}
