import { Repository } from 'typeorm';
import { Observable, from } from 'rxjs';
import { ClsService } from 'nestjs-cls';
import { ForbiddenException } from '@nestjs/common';
import { IGenericRepository } from '../../../domain';

export class PostgresGenericRepository<T> implements IGenericRepository<T> {
  constructor(
    protected readonly repository: Repository<any>,
    protected readonly cls: ClsService,
    protected readonly isTenantScoped: boolean = true,
  ) {}

  protected get tenantId(): string | undefined {
    return this.cls.get('tenantId');
  }

  /**
   * Fail-closed: las entidades multi-tenant REQUIEREN un tenantId en el contexto
   * CLS. Si falta (jobs en background, webhooks, llamadas internas), lanzamos
   * ForbiddenException en lugar de retornar datos de TODOS los tenants.
   * Esto previene fugas de datos cross-tenant (ISSUE-002).
   */
  protected assertTenantContext(): void {
    if (this.isTenantScoped && !this.tenantId) {
      throw new ForbiddenException(
        'Operación bloqueada: falta el contexto de tenant (tenantId). ' +
        'Posible bypass de aislamiento multi-tenant en job/webhook/llamada interna.',
      );
    }
  }

  getAll(): Observable<T[]> {
    this.assertTenantContext();
    const whereClause = this.isTenantScoped ? { tenantId: this.tenantId } : {};
    return from(this.repository.find({ where: whereClause }) as Promise<T[]>);
  }

  get(id: string): Observable<T | null> {
    this.assertTenantContext();
    const whereClause: any = { id };
    if (this.isTenantScoped) whereClause.tenantId = this.tenantId;

    return from(this.repository.findOne({ where: whereClause }) as Promise<T | null>);
  }

  getById(id: string): Observable<T | null> {
    return this.get(id);
  }

  create(item: T): Observable<T> {
    this.assertTenantContext();
    const entityToSave = this.isTenantScoped ? { ...item, tenantId: this.tenantId } : item;

    return from(this.repository.save(entityToSave) as Promise<T>);
  }

  update(id: string, item: T): Observable<T | null> {
    this.assertTenantContext();

    return from((async () => {
      const whereClause: any = { id };
      if (this.isTenantScoped) whereClause.tenantId = this.tenantId;

      const existing = await this.repository.findOne({ where: whereClause });
      if (!existing) {
        return null;
      }

      const entityToSave = { ...existing, ...item, id };

      return (await this.repository.save(entityToSave)) as unknown as T;
    })());
  }

  find(options?: {
    where?: any;
    relations?: string[];
    order?: any;
    take?: number;
    skip?: number;
  }): Observable<T[]> {
    this.assertTenantContext();
    const whereClause = { ...options?.where };
    if (this.isTenantScoped) {
      whereClause.tenantId = this.tenantId;
    }

    return from(this.repository.find({
      ...options,
      where: whereClause
    }) as Promise<T[]>);
  }

  findOne(options?: {
    where?: any;
    relations?: string[];
  }): Observable<T | null> {
    this.assertTenantContext();
    const whereClause = { ...options?.where };
    if (this.isTenantScoped) {
      whereClause.tenantId = this.tenantId;
    }

    return from(this.repository.findOne({
      ...options,
      where: whereClause
    }) as Promise<T | null>);
  }
}
