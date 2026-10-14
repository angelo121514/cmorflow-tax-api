import { AsyncLocalStorage } from "node:async_hooks";
import { EntityManager } from "typeorm";

const context = new AsyncLocalStorage<{
  tenantId: string;
  manager: EntityManager;
}>();

export function currentTenantManager(
  tenantId: string,
): EntityManager | undefined {
  const active = context.getStore();
  if (active && active.tenantId !== tenantId)
    throw new Error("Cross-tenant transaction rejected.");
  return active?.manager;
}

/** One connection for all repositories, config, DTE and outbox writes. */
export async function tenantTransaction<T>(
  manager: EntityManager,
  tenantId: string,
  operation: (manager: EntityManager) => Promise<T>,
): Promise<T> {
  const active = currentTenantManager(tenantId);
  if (active) return operation(active);
  return manager.transaction(async (transaction) => {
    await transaction.query(`SELECT set_config('app.tenant_id', $1, true)`, [
      tenantId,
    ]);
    return context.run({ tenantId, manager: transaction }, () =>
      operation(transaction),
    );
  });
}
