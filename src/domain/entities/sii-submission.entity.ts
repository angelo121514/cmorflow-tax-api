export class SiiSubmissionEntity {
  id?: string;
  tenantId: string;
  trackId: string;
  status: 'PENDIENTE' | 'ENVIADO' | 'PROCESADO' | 'RECHAZADO' | 'ERROR';
  responseXml?: string;
  errorMessage?: string;
  submissionType?: 'DTE' | 'LIBRO_CV';
  bookOperation?: 'VENTA' | 'COMPRA';
  taxPeriod?: string;
  bookSendType?: 'TOTAL' | 'AJUSTE';
  idempotencyKey?: string;
  createdAt?: Date;
  updatedAt?: Date;
}
