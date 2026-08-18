import { Observable } from 'rxjs';

/**
 * Repositorio genérico que retorna Observable<T>.
 * Los use cases consumen los datos vía `await firstValueFrom(repo.xxx())`,
 * y las implementaciones (TypeORM/Memory) convierten internamente a Observables.
 */
export abstract class IGenericRepository<T> {
  abstract getAll(): Observable<T[]>;
  abstract get(id: string): Observable<T | null>;
  abstract getById(id: string): Observable<T | null>;
  abstract create(item: T): Observable<T>;
  abstract update(id: string, item: Partial<T>): Observable<T | null>;

  /**
   * Busca registros coincidiendo con los criterios y opciones de consulta especificados.
   * Filtra automáticamente por tenantId si la entidad es multi-tenant.
   */
  abstract find(options?: {
    where?: any;
    relations?: string[];
    order?: any;
    take?: number;
    skip?: number;
  }): Observable<T[]>;

  /**
   * Encuentra el primer registro que coincida con el criterio especificado.
   * Filtra automáticamente por tenantId si la entidad es multi-tenant.
   */
  abstract findOne(options?: {
    where?: any;
    relations?: string[];
  }): Observable<T | null>;
}
