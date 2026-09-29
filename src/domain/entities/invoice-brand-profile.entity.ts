/**
 * Versión inmutable de la identidad visual aplicada a documentos tributarios.
 *
 * Cada DTE guarda la versión que le corresponde, de modo que un cambio de logo
 * o colores no altere una representación impresa ya emitida.
 */
export class InvoiceBrandProfileEntity {
  id?: string;
  tenantId: string;
  version: number;
  /** Logo ya normalizado para su inclusión en el PDF; puede no existir. */
  logoData?: Buffer | null;
  logoMimeType?: 'image/png' | 'image/jpeg' | null;
  logoSha256?: string | null;
  primaryColor: string;
  secondaryColor: string;
  /** Credencial que creó la versión, cuando se originó por la API B2B. */
  createdByCredentialId?: string | null;
  createdAt?: Date;
}
