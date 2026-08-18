// backend/src/domain/entities/rcof-submission.entity.ts
/**
 * RCOF (Consumo de Folios) generado, persistido y transmitido al SII.
 *
 * Idempotente por (tenant, fecha, secuencia). Hasta ahora el RCOF sólo se
 * retornaba firmado sin persistir ni transmitir; esta entidad cierra el ciclo.
 */
export class RcofSubmissionEntity {
  id?: string;
  tenantId: string;
  /** Fecha del consumo de folios (YYYY-MM-DD). */
  periodDate: string;
  /** Número secuencial de envío del RCOF para la fecha. */
  sequence: number;
  /** XML Doc_RCOF firmado. */
  xmlContent: string;
  trackId?: string | null;
  /** submitted | accepted | observed | rejected | failed */
  status: 'submitted' | 'accepted' | 'observed' | 'rejected' | 'failed';
  /** Respuesta/detalle del SII (TrackID, estado, errores). */
  siiResponse?: any;
  createdAt?: Date;
  updatedAt?: Date;
}
