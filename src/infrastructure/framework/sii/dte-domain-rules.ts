/**
 * Reglas de dominio tributario del SII verificadas contra documentación oficial.
 *
 * Fuentes:
 *  - Formato Boletas Electrónicas (formato_boletas_elec_202306.pdf)
 *  - SII FAQ 3670 — Factura de Compra Electrónica
 *  - SII FAQ 6461 — Habilitación T46
 *  - Resolución SII N.º 154 de 2025 — Guías de Despacho (vigente desde 2026-05-01)
 *  - Proceso de Certificación SII (1039-proceso_certificacion-1184.html)
 *  - Instructivo Certificación Boletas (guia_emitir_boleta_servicio.htm)
 *
 * Este archivo centraliza las reglas del SII para que el motor XML, el engine de
 * descuentos, el orquestador de certificación y los DTOs las consuman desde un
 * único lugar y mantener la consistencia tributaria.
 */

/**
 * Modo de pricing del DTE.
 * - GROSS: el precio del ítem incluye IVA (típico de boletas al consumidor final).
 * - NET: el precio del ítem es neto, el IVA se calcula y suma por separado.
 *
 * En el XML de boleta, NET se representa con <IndMntNeto>2</IndMntNeto>.
 * Cuando no se usa IndMntNeto, el formato de boleta contempla que los montos
 * ya incluyen IVA (GROSS) y el neto se deriva dividiendo por (1 + tasa).
 */
export type PricingMode = 'GROSS' | 'NET';

/**
 * Retención tributaria aplicable a un DTE.
 *
 * Caso típico: Factura de Compra Electrónica (T46) con retención total de IVA.
 * El SII usa <ImptoReten> con TipoImp=15 (IVA Retenido Total).
 */
export interface DteTaxRetention {
  /** Tipo de impuesto: 15 = IVA Retenido Total */
  type: number;
  /** Tasa del impuesto (ej. 19 para 19%) */
  rate?: number;
  /** Monto retenido en CLP */
  amount: number;
}

/**
 * Identificación del proveedor de software para boletas electrónicas.
 *
 * El formato oficial de boleta incluye <RutProvSW> y <RznSocProvSW> en la
 * Carátula del EnvioBOLETA, identificando al proveedor de software SaaS que
 * generó el documento. Es relevante para la trazabilidad tributaria del SII.
 */
export interface SoftwareProvider {
  /** RUT del proveedor de software — va en <RutProvSW> */
  rut: string;
  /** Razón social del proveedor — va en <RznSocProvSW> */
  businessName: string;
}

/**
 * Modelo de transporte de primera clase para Guía de Despacho (T52).
 *
 * La Resolución SII N.º 154 de 2025 (vigente desde 2026-05-01) estableció
 * nuevas exigencias para el bloque <Transporte> del DTE tipo 52, incluyendo
 * fechas de salida/llegada, origen, destino, RUT del transportista y datos
 * del vehículo.
 */
export interface DteTransport {
  /**
   * Indicador de traslado (IndTraslado).
   * 1=Venta, 2=Consignación, 3=Entrega gratuita, 4=Comprobante,
   * 5=Traslado interno entre bodegas propias, 6=Devolución.
   */
  transferType: number;
  /** Fecha de salida del traslado (FchSalida, YYYY-MM-DD) */
  departureDate?: string;
  /** Hora de salida del traslado (HraSalida, HH:MM:SS) */
  departureTime?: string;
  /** Fecha de llegada del traslado (FchLlegada, YYYY-MM-DD) */
  arrivalDate?: string;
  /** Dirección de origen (DirOrigen) */
  originAddress: string;
  /** Comuna de origen (CmnaOrigen) */
  originCommune: string;
  /** Dirección de destino (DirDest) */
  destinationAddress: string;
  /** Comuna de destino (CmnaDest) */
  destinationCommune: string;
  /** RUT del transportista (RUTTrans) */
  carrierRut?: string;
  /** RUT del chofer (RUTChofer) */
  driverRut?: string;
  /** Nombre del chofer (NombreChofer) */
  driverName?: string;
  /** Patente del vehículo (Patente) */
  vehiclePlate?: string;
  /** Patente del acoplado/remolque (PatenteAcoplado) */
  trailerPlate?: string;
}

// ═══════════════════════════════════════════════════════════════
//  Constantes de receptor
// ═══════════════════════════════════════════════════════════════

/**
 * RUT genérico de consumidor final para boletas a nivel de documento.
 * Se usa en <Receptor><RUTRecep> cuando el cliente no está identificado.
 * Fuente: Formato Boletas Electrónicas SII.
 */
export const BOLETA_GENERIC_RECEIVER = '66666666-6';

/**
 * RUT del SII como receptor del envelope EnvioBOLETA.
 * Va en <Caratula><RutReceptor> del EnvioBOLETA, NO en el documento.
 * El SII es siempre el receptor del envelope de boletas.
 */
export const BOLETA_ENVELOPE_RECEIVER = '60803000-K';

// ═══════════════════════════════════════════════════════════════
//  Reglas de autorización
// ═══════════════════════════════════════════════════════════════

/**
 * Tipos de DTE que requieren autorización especial del SII antes de poder emitir.
 * El tenant debe solicitar autorización mediante petición administrativa o
 * formulario 2117 en la unidad del SII correspondiente.
 *
 * T46 (Factura de Compra Electrónica): requiere petición administrativa,
 * NO está habilitada para todos los contribuyentes.
 * Fuente: SII FAQ 6461.
 */
export const RESTRICTED_DTE_TYPES = new Set<number>([46]);

/**
 * Verifica si un tipo de DTE requiere autorización especial del SII.
 */
export function requiresSpecialAuth(type: number): boolean {
  return RESTRICTED_DTE_TYPES.has(type);
}

// ═══════════════════════════════════════════════════════════════
//  Reglas de emisor/receptor por tipo
// ═══════════════════════════════════════════════════════════════

/**
 * En la Factura de Compra Electrónica (T46), los roles se invierten:
 * - El COMPRADOR es el EMISOR del documento.
 * - El VENDEDOR/proveedor es el RECEPTOR del documento.
 *
 * Esto es distinto a la factura normal (T33) donde el vendedor emite y el
 * comprador recibe. El SII lo describe así en FAQ 3670.
 */
export function isPurchaseInvoice(type: number): boolean {
  return type === 46;
}

/**
 * Indica si un tipo de DTE es una boleta electrónica (39 o 41).
 */
export function isBoleta(type: number): boolean {
  return type === 39 || type === 41;
}

/**
 * Indica si un tipo de DTE es exento (no genera IVA).
 * T34 (Factura Exenta) y T41 (Boleta Exenta) son exentos por definición.
 */
export function isExemptType(type: number): boolean {
  return type === 34 || type === 41;
}

// ═══════════════════════════════════════════════════════════════
//  Códigos de retención tributaria
// ═══════════════════════════════════════════════════════════════

/**
 * Tipo de impuesto 15: IVA Retenido Total.
 * Se usa en <ImptoReten><TipoImp>15</TipoImp> para T46 con retención total.
 * En este caso, el IVA se cancela con la retención y MntTotal = MntNeto + MntExe.
 */
export const TAX_TYPE_IVA_RETENTION_TOTAL = 15;

// ═══════════════════════════════════════════════════════════════
//  Indicadores de servicio para boletas
// ═══════════════════════════════════════════════════════════════

/**
 * Indicador de servicio (IndServicio) para boletas electrónicas.
 * 1=Servicios periódicos, 2=Servicios periódicos hogares,
 * 3=Servicios no periódicos, 4=Boleta venta interna y otros.
 */
export const BOLETA_SERVICE_INDICATOR = {
  PERIODIC: 1,
  PERIODIC_HOME: 2,
  NON_PERIODIC: 3,
  INTERNAL_SALE: 4,
} as const;