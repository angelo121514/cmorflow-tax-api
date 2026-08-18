export class TenantEntity {
  id: string;
  rut: string;
  businessName: string;
  createdAt: Date;
  /** Fin del período de prueba gratuito (15 días desde el registro). */
  trialEndsAt?: Date;
  /** Plan activo: 'standard' | 'full'. null mientras esté en trial. */
  planId?: string | null;
  /** Fecha de solicitud de eliminación GDPR (anonimización PII). */
  gdprDeletedAt?: Date | null;
  /** Fecha hasta la cual se retienen registros tributarios (SII, 6 años). */
  dataRetentionUntil?: Date | null;
  /** Email dedicado para cobranza (dunning). Si null, se usa el del admin. */
  billingEmail?: string | null;
}
