import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Observable, from, switchMap } from 'rxjs';
import { ClsService } from 'nestjs-cls';
import { DataSource } from 'typeorm';

/**
 * SetTenantContextInterceptor
 *
 * Establece el contexto de tenant a nivel de sesión de PostgreSQL para que
 * Row Level Security (RLS) pueda aislar los datos por tenant como defensa en
 * profundidad (defense-in-depth), complementando el fail-closed del
 * PostgresGenericRepository (ISSUE-002).
 *
 * Es un INTERCEPTOR (no middleware) para correr DESPUÉS del TenantInterceptor,
 * que es quien setea el tenantId en el CLS. El orden de registro en AppModule
 * determina el orden de ejecución: TenantInterceptor primero, este después.
 *
 * Ejecuta `SET LOCAL app.tenant_id = '<uuid>'` en la conexión del pool que
 * atenderá la request. La política RLS `tenant_isolation` usa este setting:
 *
 *   CREATE POLICY tenant_isolation ON <tabla>
 *     USING (tenant_id::text = current_setting('app.tenant_id', true));
 *
 * IMPORTANTE / LIMITACIONES:
 * - TypeORM no garantiza que todas las queries de una request usen la misma
 *   conexión del pool (a menos que se use un QueryRunner explícito o transacción).
 *   Si una query cae en otra conexión, el SET LOCAL no aplicará.
 * - Por eso, la defensa PRIMARIA es el fail-closed del repositorio genérico.
 *   RLS es defensa secundaria (defense-in-depth).
 * - En jobs en background (sin request HTTP), el tenantId debe setearse
 *   explícitamente al inicio del job.
 */
@Injectable()
export class SetTenantContextInterceptor implements NestInterceptor {
  private readonly logger = new Logger(SetTenantContextInterceptor.name);

  constructor(
    private readonly cls: ClsService,
    private readonly dataSource: DataSource,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const tenantId = this.cls.get<string>('tenantId');

    if (!tenantId) {
      // Sin tenantId (request pública o job sin contexto): no aplicar RLS vía SET LOCAL.
      // El fail-closed del repositorio protege las operaciones multi-tenant.
      return next.handle();
    }

    // Establecer la variable de sesión ANTES de que el handler ejecute sus queries.
    // SET LOCAL dura solo la transacción/conexión actual.
    return from(
      this.dataSource.query(`SET LOCAL app.tenant_id = '${tenantId}';`).catch((error) => {
        // No bloquear la request si RLS no está activo todavía (despliegue incremental).
        // El fail-closed del repositorio sigue protegiendo.
        this.logger.debug(
          `No se pudo setear app.tenant_id (RLS probablemente aún no activo): ${(error as Error).message}`,
        );
      }),
    ).pipe(switchMap(() => next.handle()));
  }
}
