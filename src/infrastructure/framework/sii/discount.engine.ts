import { Injectable } from '@nestjs/common';
import { DteLineItem, DteTotals, SupportedDteType } from './dte-types';

/**
 * Resultado del descuento aplicado a una línea de detalle.
 */
export interface ItemDiscountResult {
  /** Monto bruto de la línea: quantity × price */
  grossAmount: number;
  /** Monto descontado (0 si no hay descuento) */
  discountAmount: number;
  /** Monto neto de la línea tras descuento */
  netAmount: number;
  /** true si el descuento fue por porcentaje, false si fue por monto fijo */
  isPercentage: boolean;
  /** Porcentaje aplicado (si fue por porcentaje) */
  percentage?: number;
}

/**
 * Resultado del descuento global aplicado al monto neto afecto.
 */
export interface GlobalDiscountResult {
  /** Monto neto afecto antes del descuento global */
  netBeforeDiscount: number;
  /** Monto descontado */
  discountAmount: number;
  /** Monto neto afecto después del descuento global */
  netAfterDiscount: number;
}

/**
 * Opciones para el cálculo de totales.
 */
export interface CalculateTotalsOptions {
  /** Descuento global en porcentaje (0-100), aplicable solo a ítems afectos */
  globalDiscountPercentage?: number;
  /**
   * Modo de pricing del DTE.
   * - GROSS: los precios de los ítems incluyen IVA (típico de boletas).
   *   El motor descompone el precio bruto a neto: neto = round(gross / 1.19).
   * - NET (default): los precios son netos, el IVA se calcula y suma por separado.
   */
  pricingMode?: 'GROSS' | 'NET';
}

/**
 * Motor de descuentos y cálculo tributario del DTE.
 *
 * Principio: el motor XML no calcula. Este motor sí.
 *
 * Responsabilidades:
 *  - Aplicar descuentos por línea (porcentaje o monto fijo)
 *  - Aplicar descuento global sobre ítems afectos (no exentos)
 *  - Calcular IVA (19%) sobre el neto YA descontado
 *  - Calcular total final
 *
 * Reglas tributarias (SII):
 *  - Los descuentos globales aplican SOLO a ítems afectos, nunca a exentos.
 *  - El IVA se calcula sobre el monto neto tras descuentos, no sobre el bruto.
 *  - Todo monto se redondea al entero más cercano (CLP no tiene decimales).
 */
@Injectable()
export class DiscountEngine {
  private static readonly IVA_RATE = 0.19;

  /**
   * Aplica el descuento a una línea de detalle.
   *
   * Reglas:
   *  - Solo se puede usar UN tipo de descuento (XOR): porcentaje O monto fijo.
   *  - El descuento no puede superar el monto bruto de la línea.
   *  - El monto bruto = quantity × price.
   */
  applyItemDiscount(item: DteLineItem): ItemDiscountResult {
    const grossAmount = Math.round(item.quantity * item.price);
    const hasPercentage = item.discountPercentage != null && item.discountPercentage !== 0;
    const hasAmount = item.discountAmount != null && item.discountAmount !== 0;

    if (hasPercentage && hasAmount) {
      throw new Error(
        'Descuento por porcentaje y por monto no pueden usarse simultáneamente en la misma línea.',
      );
    }

    if (!hasPercentage && !hasAmount) {
      return { grossAmount, discountAmount: 0, netAmount: grossAmount, isPercentage: false };
    }

    if (hasPercentage) {
      const pct = item.discountPercentage!;
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
        throw new Error(`Porcentaje de descuento fuera de rango (0-100): ${pct}`);
      }
      this.assertPercentagePrecision(pct, 'El porcentaje de descuento');
      const discountAmount = Math.round((grossAmount * pct) / 100);
      return {
        grossAmount,
        discountAmount,
        netAmount: grossAmount - discountAmount,
        isPercentage: true,
        percentage: pct,
      };
    }

    // Descuento por monto fijo
    const discountAmount = Math.round(item.discountAmount!);
    if (discountAmount > grossAmount) {
      throw new Error(
        `Descuento (${discountAmount}) mayor al monto bruto de la línea (${grossAmount}).`,
      );
    }
    return {
      grossAmount,
      discountAmount,
      netAmount: grossAmount - discountAmount,
      isPercentage: false,
    };
  }

  /**
   * Aplica el descuento global al monto neto afecto.
   * NO aplica a exentos (por definición tributaria del SII).
   */
  applyGlobalDiscount(netAmount: number, percentage: number): GlobalDiscountResult {
    if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
      throw new Error(`Porcentaje de descuento global fuera de rango (0-100): ${percentage}`);
    }
    this.assertPercentagePrecision(percentage, 'El porcentaje de descuento global');
    if (percentage === 0) {
      return { netBeforeDiscount: netAmount, discountAmount: 0, netAfterDiscount: netAmount };
    }
    const discountAmount = Math.round((netAmount * percentage) / 100);
    return {
      netBeforeDiscount: netAmount,
      discountAmount,
      netAfterDiscount: netAmount - discountAmount,
    };
  }

  /**
   * Calcula los totales tributarios completos de un DTE.
   *
   * Orden de aplicación:
   *  1. Descuentos por línea a cada ítem
   *  2. Sumar neto afecto y exento
   *  3. Descuento global SOLO sobre el neto afecto
   *  4. IVA (19%) sobre el neto afecto YA descontado
   *  5. Total = neto + exento + IVA
   */
  calculateTotals(
    type: SupportedDteType,
    items: DteLineItem[],
    options?: CalculateTotalsOptions,
  ): DteTotals {
    const exemptOnly = type === 34 || type === 41;
    const isGross = options?.pricingMode === 'GROSS';

    let netAmount = 0;
    let exemptAmount = 0;

    // 1+2: descuentos por línea y suma por categoría
    for (const item of items) {
      const lineResult = this.applyItemDiscount(item);
      if (exemptOnly || item.exempt) {
        // Items exentos: el precio es el monto final, sin descomponer IVA.
        exemptAmount += lineResult.netAmount;
      } else if (isGross) {
        // Boletas GROSS: el precio incluye IVA. Descomponer a neto.
        // neto = round(gross / (1 + tasa))
        const netLineAmount = Math.round(lineResult.netAmount / (1 + DiscountEngine.IVA_RATE));
        netAmount += netLineAmount;
      } else {
        netAmount += lineResult.netAmount;
      }
    }

    // 3: descuento global sobre neto afecto
    let globalDiscountAmount = 0;
    if (options?.globalDiscountPercentage && options.globalDiscountPercentage > 0 && netAmount > 0) {
      const globalResult = this.applyGlobalDiscount(netAmount, options.globalDiscountPercentage);
      globalDiscountAmount = globalResult.discountAmount;
      netAmount = globalResult.netAfterDiscount;
    }

    // 4: IVA sobre neto descontado
    const ivaAmount = Math.round(netAmount * DiscountEngine.IVA_RATE);

    // 5: total
    const totalAmount = netAmount + exemptAmount + ivaAmount;

    const totals: DteTotals = {
      netAmount,
      exemptAmount,
      ivaAmount,
      totalAmount,
    };
    if (globalDiscountAmount > 0) {
      totals.globalDiscountAmount = globalDiscountAmount;
    }
    return totals;
  }

  /**
   * Calcula el IVA (19%) sobre un monto neto dado.
   */
  calculateVat(netAmount: number): number {
    return Math.round(netAmount * DiscountEngine.IVA_RATE);
  }

  private assertPercentagePrecision(value: number, label: string): void {
    // El XSD de SII permite como máximo dos decimales para porcentajes. La
    // tolerancia evita rechazar valores binarios equivalentes, como 5.1.
    const scaled = value * 100;
    if (Math.abs(scaled - Math.round(scaled)) > 1e-8) {
      throw new Error(`${label} debe tener como máximo 2 decimales.`);
    }
  }
}
