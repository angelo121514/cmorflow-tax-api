import { IGenericRepository } from '../../../domain';
import { Observable, of } from 'rxjs';

export class MemoryGenericRepository<T> implements IGenericRepository<T> {
  private readonly items: Map<string, T> = new Map<string, T>();

  getAll(): Observable<T[]> {
    return of(Array.from(this.items.values()));
  }

  get(id: string): Observable<T | null> {
    return of(this.items.get(id) || null);
  }

  getById(id: string): Observable<T | null> {
    return this.get(id);
  }

  create(item: T): Observable<T> {
    const itemWithId = item as any;
    const id = itemWithId.id || Math.random().toString(36).substring(2, 11);
    const newItem = { ...item, id };
    this.items.set(id, newItem);
    return of(newItem as T);
  }

  update(id: string, item: T): Observable<T | null> {
    if (this.items.has(id)) {
      // Merge shallow: preserva campos no incluidos en el patch (igual que TypeORM).
      const existing = this.items.get(id);
      const updatedItem = { ...existing, ...item, id };
      this.items.set(id, updatedItem);
      return of(updatedItem);
    }
    return of(null);
  }

  find(options?: {
    where?: any;
    relations?: string[];
    order?: any;
    take?: number;
    skip?: number;
  }): Observable<T[]> {
    let list = Array.from(this.items.values());
    if (options && options.where) {
      list = list.filter(item => {
        for (const key of Object.keys(options.where)) {
          if ((item as any)[key] !== options.where[key]) {
            return false;
          }
        }
        return true;
      });
    }
    // Handle paging
    if (options && options.skip !== undefined) {
      list = list.slice(options.skip);
    }
    if (options && options.take !== undefined) {
      list = list.slice(0, options.take);
    }
    return of(list);
  }

  findOne(options?: {
    where?: any;
    relations?: string[];
  }): Observable<T | null> {
    let list = Array.from(this.items.values());
    if (options && options.where) {
      list = list.filter(item => {
        for (const key of Object.keys(options.where)) {
          if ((item as any)[key] !== options.where[key]) {
            return false;
          }
        }
        return true;
      });
    }
    return of(list[0] || null);
  }
}
