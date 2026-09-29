export class DteDocumentEntity {
  id?: string;
  tenantId: string;
  type: number; // 33 = Factura, 61 = Nota de Crédito, 56 = Nota de Débito, etc.
  folio: number;
  receiverRut: string;
  receiverName: string;
  amount: number;
  xmlContent: string;
  /** Perfil visual inmutable vigente al momento de emitir el DTE. */
  brandProfileId?: string | null;
  signatureValue?: string;
  status: 'BORRADOR' | 'FIRMADO' | 'ENVIADO' | 'ACEPTADO' | 'RECHAZADO' | 'REPARO' | 'ANULADO';
  trackId?: string;
  statusHistory?: Array<{
    status: string;
    timestamp: Date;
    user: string;
    detail: string;
  }>;
  createdAt?: Date;
  updatedAt?: Date;
}
