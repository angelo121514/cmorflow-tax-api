import * as forge from 'node-forge';
import { DteTaxRetention, SoftwareProvider } from './dte-domain-rules';

export type SupportedDteType = 33 | 34 | 39 | 41 | 46 | 52 | 56 | 61;


export interface DteParty {
  rut: string;
  businessName: string;
  giro?: string;
  acteco?: string;
  address?: string;
  commune?: string;
  city?: string;
}

export interface DteLineItem {
  name: string;
  quantity: number;
  price: number;
  exempt?: boolean;
  /**
   * Descuento por línea en porcentaje (0-100).
   * Genera el nodo <DscItem>/<DescuentoPct> del XML del DTE.
   * Caso 2 del Set de Pruebas SII.
   */
  discountPercentage?: number;
  /**
   * Descuento por línea en monto fijo (CLP).
   * Genera el nodo <DscItem>/<DescuentoMonto> del XML del DTE.
   * Alternativa a discountPercentage.
   */
  discountAmount?: number;
}

export interface DteReference {
  type: number;
  folio: number | string;
  date: string;
  reasonCode?: number;
  reason?: string;
}

export interface DteBuildInput {
  type: SupportedDteType;
  folio: number;
  issueDate?: string;
  issuer: DteParty;
  receiver: DteParty;
  items: DteLineItem[];
  cafXml?: string;
  /**
   * Clave privada del CAF para firmar el TED del DTE.
   * En producción se obtiene del RSASK del archivo <AUTORIZACION>, cifrado en
   * el vault del tenant y entregado al motor sólo durante la firma.
   * En simulación puede extraerse del archivo de autorización completo.
   */
  cafPrivateKey?: forge.pki.rsa.PrivateKey;
  references?: DteReference[];
  indTraslado?: number;
  /**
   * Descuento global aplicable a los ítems afectos (no exentos).
   * Genera el nodo <DscRcgloGlobal> con tipo "D" (descuento) en el bloque <Totales>.
   * Caso 4 del Set de Pruebas SII.
   */
  globalDiscountPercentage?: number;
  /**
   * Modelo de transporte de primera clase para Guía de Despacho (T52).
   * Resolución SII N.º 154 de 2025 (vigente desde 2026-05-01).
   * Si se provee, reemplaza el bloque de transporte legacy.
   */
  transport?: DteTransportModel;
  /**
   * Retenciones tributarias para el DTE.
   * Caso típico: T46 Factura de Compra con retención total de IVA (TipoImp=15).
   * Genera nodos <ImptoReten> en el bloque <Totales>.
   */
  taxRetentions?: DteTaxRetention[];
  /**
   * Modo de pricing del DTE.
   * - GROSS: precios incluyen IVA (típico de boletas al consumidor final).
   * - NET: precios son netos, IVA se suma por separado (IndMntNeto=2 en boletas).
   * Default: NET para facturas, GROSS para boletas.
   */
  pricingMode?: 'GROSS' | 'NET';
  /**
   * Indicador de servicio para boletas electrónicas (IndServicio).
   * 1=Periódicos, 2=Periódicos hogares, 3=No periódicos, 4=Boleta venta interna.
   */
  indServicio?: number;
  /**
   * Proveedor de software para boletas (RutProvSW / RznSocProvSW).
   * Se renderiza en la Carátula del EnvioBOLETA, no en el documento individual.
   */
  softwareProvider?: SoftwareProvider;
  /**
   * Referencia al SET del SII para boletas de certificación.
   * Genera <Referencia><TpoDocRef>SET</TpoDocRef> con la glosa del caso.
   * Solo boletas de certificación.
   */
  setRef?: string;
  /** Glosa del SET (ej: "CASO-1"). Se renderiza en <RazonRef>. */
  setRefReason?: string;
}

export interface DteTotals {
  netAmount: number;
  exemptAmount: number;
  ivaAmount: number;
  totalAmount: number;
  /**
   * Monto del descuento global aplicado a los ítems afectos (no exentos).
   * Genera el nodo <DscRcgloGlobal><ValorCF> en el XML.
   * Solo presente cuando se aplicó descuento global.
   */
  globalDiscountAmount?: number;
  /**
   * Monto total de retenciones tributarias (ej. IVA retenido en T46).
   * MntTotal = netAmount + exemptAmount + ivaAmount - retentionAmount.
   * Solo presente cuando hay retenciones.
   */
  retentionAmount?: number;
}

export interface BuiltDteXml {
  xml: string;
  tedXml: string;
  totals: DteTotals;
  type: SupportedDteType;
  folio: number;
}

/**
 * Modelo de transporte de primera clase para Guía de Despacho (T52).
 * Re-exportado desde dte-domain-rules para conveniencia de los consumidores
 * de dte-types. Ver dte-domain-rules.ts para documentación completa.
 */
export type DteTransportModel = import('./dte-domain-rules').DteTransport;

export interface EnvioDteInput {
  issuerRut: string;
  senderRut: string;
  receiverRut?: string;
  signedDtes: string[];
  resolutionDate?: string;
  resolutionNumber?: number;
  /**
   * Proveedor de software para EnvioBOLETA (RutProvSW / RznSocProvSW).
   * Solo se renderiza en el envelope de boletas.
   */
  softwareProvider?: SoftwareProvider;
}

export interface RcofSummaryRange {
  start: number;
  end: number;
}

export interface RcofDocumentSummary {
  type: 39 | 41;
  netAmount: number;
  ivaAmount: number;
  exemptAmount: number;
  totalAmount: number;
  foliosEmitidos: number;
  foliosAnulados: number;
  foliosUtilizados: number;
  ranges: RcofSummaryRange[];
}

export interface RcofInput {
  issuerRut: string;
  senderRut: string;
  resolutionDate?: string;
  resolutionNumber?: number;
  sequenceNumber: number;
  startDate: string;
  endDate: string;
  summaries: RcofDocumentSummary[];
}

