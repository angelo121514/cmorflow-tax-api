export class AuditLogEntity {
  id?: string;
  tenantId: string;
  userId?: string;
  action: string;
  ipAddress?: string;
  userAgent?: string;
  payload?: any;
  /** Hash del registro anterior en la cadena (null para el primero). */
  prevHash?: string | null;
  /** Hash HMAC-SHA256 de este registro (sobre id+tenantId+action+payload+prevHash). */
  hash?: string | null;
  /** Número de secuencia global monótono (para detectar inserciones fuera de orden). */
  sequence?: number;
  createdAt?: Date;
}
