export enum Permission {
  DTE_EMIT = 'DTE_EMIT',
  DTE_VIEW = 'DTE_VIEW',
  POS_SELL = 'POS_SELL',
  INVENTORY_ADJUST = 'INVENTORY_ADJUST',
  INVENTORY_VIEW = 'INVENTORY_VIEW',
  ACCOUNTING_VIEW = 'ACCOUNTING_VIEW',
  ACCOUNTING_MANAGE = 'ACCOUNTING_MANAGE',
  RRHH_VIEW = 'RRHH_VIEW',
  RRHH_MANAGE = 'RRHH_MANAGE',
  ADMIN_USERS = 'ADMIN_USERS',
  SUPPLIER_MANAGE = 'SUPPLIER_MANAGE',
  DTE_EXCHANGE = 'DTE_EXCHANGE',
  INTEGRATION_MANAGE = 'INTEGRATION_MANAGE',
}

export const RolePermissions: Record<string, Permission[]> = {
  ADMIN: Object.values(Permission),
  OPERATOR: [
    Permission.DTE_EMIT,
    Permission.DTE_VIEW,
    Permission.POS_SELL,
    Permission.INVENTORY_VIEW,
    Permission.INVENTORY_ADJUST,
    Permission.SUPPLIER_MANAGE,
    Permission.DTE_EXCHANGE,
  ],
  MEMBER: [
    Permission.DTE_VIEW,
    Permission.POS_SELL,
    Permission.INVENTORY_VIEW,
  ],
};
