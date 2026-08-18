import { IsNotEmpty, IsNumber, IsString, IsArray, ValidateNested, Min, Max, IsPositive, IsOptional, ValidateIf, IsIn } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { IsChileanRut } from '../../infrastructure/decorators/is-chilean-rut.decorator';

/**
 * Tipos de DTE soportados por el motor.
 * 33=Factura, 34=Exenta, 39=Boleta, 41=Boleta Exenta,
 * 46=Factura Compra, 52=Guía, 56=ND, 61=NC.
 */
export const SUPPORTED_DTE_TYPES = [33, 34, 39, 41, 46, 52, 56, 61];

export class DteReferenceDto {
  @ApiProperty({ example: 33, description: 'Tipo de documento de referencia (33: Factura)' })
  @IsNotEmpty()
  @IsNumber()
  type: number;

  @ApiProperty({ example: 154, description: 'Folio del documento referenciado' })
  @IsNotEmpty()
  @IsNumber()
  folio: number;

  @ApiProperty({ example: '2026-06-01', description: 'Fecha del documento referenciado (YYYY-MM-DD)' })
  @IsNotEmpty()
  @IsString()
  date: string;

  @ApiProperty({ example: 1, required: false, description: 'Código de referencia (1: Anula, 2: Corrige, 3: Corrige Montos)' })
  @IsOptional()
  @IsNumber()
  reasonCode?: number;

  @ApiProperty({ example: 'Error de digitación', required: false, description: 'Glosa descriptiva' })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class DteItemDto {
  @ApiProperty({ example: 'Servicio de Hosting B2B', description: 'Nombre o descripción del producto o servicio' })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiProperty({ example: 1, description: 'Cantidad' })
  @IsNotEmpty()
  @IsNumber()
  @IsPositive()
  quantity: number;

  @ApiProperty({ example: 50000, description: 'Precio unitario en CLP (neto o bruto según pricingMode)' })
  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  price: number;

  @ApiProperty({ example: false, required: false, description: 'Indica si el ítem es exento' })
  @IsOptional()
  @Type(() => Boolean)
  exempt?: boolean;

  @ApiProperty({ example: 'Kg', required: false, description: 'Unidad de medida (ej: Kg, Lt, m)' })
  @IsOptional()
  @IsString()
  unit?: string;

  @ApiProperty({ example: 10, required: false, description: 'Descuento por línea en porcentaje (0-100). No se puede usar junto a discountAmount.' })
  @IsOptional()
  @ValidateIf((o) => !o.discountAmount)
  @IsNumber()
  @Min(0)
  @Max(100)
  discountPercentage?: number;

  @ApiProperty({ example: 250, required: false, description: 'Descuento por línea en monto fijo (CLP). No se puede usar junto a discountPercentage.' })
  @IsOptional()
  @ValidateIf((o) => !o.discountPercentage)
  @IsNumber()
  @Min(0)
  discountAmount?: number;
}

export class DteTaxRetentionDto {
  @ApiProperty({ example: 15, description: 'Tipo de impuesto (15 = IVA Retenido Total)' })
  @IsNotEmpty()
  @IsNumber()
  type: number;

  @ApiProperty({ example: 19, required: false, description: 'Tasa del impuesto (%)' })
  @IsOptional()
  @IsNumber()
  rate?: number;

  @ApiProperty({ example: 161500, description: 'Monto retenido en CLP' })
  @IsNotEmpty()
  @IsNumber()
  amount: number;
}

export class DteTransportDto {
  @ApiProperty({ example: 1, description: 'IndTraslado: 1=Venta, 2=Consignación, 3=Gratuita, 4=Comprobante, 5=Traslado interno, 6=Devolución' })
  @IsNotEmpty()
  @IsNumber()
  transferType: number;

  @ApiProperty({ example: '2026-08-10', required: false, description: 'Fecha de salida (FchSalida)' })
  @IsOptional()
  @IsString()
  departureDate?: string;

  @ApiProperty({ example: '09:00:00', required: false, description: 'Hora de salida (HraSalida)' })
  @IsOptional()
  @IsString()
  departureTime?: string;

  @ApiProperty({ example: '2026-08-10', required: false, description: 'Fecha de llegada (FchLlegada)' })
  @IsOptional()
  @IsString()
  arrivalDate?: string;

  @ApiProperty({ example: 'Calle Origen 123', description: 'Dirección de origen (DirOrigen)' })
  @IsNotEmpty()
  @IsString()
  originAddress: string;

  @ApiProperty({ example: 'Santiago', description: 'Comuna de origen (CmnaOrigen)' })
  @IsNotEmpty()
  @IsString()
  originCommune: string;

  @ApiProperty({ example: 'Av. Destino 999', description: 'Dirección de destino (DirDest)' })
  @IsNotEmpty()
  @IsString()
  destinationAddress: string;

  @ApiProperty({ example: 'Santiago', description: 'Comuna de destino (CmnaDest)' })
  @IsNotEmpty()
  @IsString()
  destinationCommune: string;

  @ApiProperty({ example: '12345678-9', required: false, description: 'RUT del transportista (RUTTrans)' })
  @IsOptional()
  @IsString()
  carrierRut?: string;

  @ApiProperty({ example: '12345678-9', required: false, description: 'RUT del chofer (RUTChofer)' })
  @IsOptional()
  @IsString()
  driverRut?: string;

  @ApiProperty({ example: 'Juan Pérez', required: false, description: 'Nombre del chofer (NombreChofer)' })
  @IsOptional()
  @IsString()
  driverName?: string;

  @ApiProperty({ example: 'ABCD12', required: false, description: 'Patente del vehículo' })
  @IsOptional()
  @IsString()
  vehiclePlate?: string;

  @ApiProperty({ example: 'TRAILER1', required: false, description: 'Patente del acoplado/remolque' })
  @IsOptional()
  @IsString()
  trailerPlate?: string;
}

export class EmitDteDto {
  @ApiProperty({ example: 33, description: 'Tipo de DTE: 33=Factura, 34=Exenta, 39=Boleta, 41=Boleta Exenta, 46=Compra, 52=Guía, 56=ND, 61=NC' })
  @IsNotEmpty()
  @IsNumber()
  @IsIn(SUPPORTED_DTE_TYPES, { message: 'Tipo de DTE no soportado. Valores válidos: 33, 34, 39, 41, 46, 52, 56, 61' })
  type: number;

  @ApiProperty({ example: '76123456-7', required: false, description: 'RUT del receptor. Opcional para boletas (usa 66666666-6 por defecto).' })
  @IsOptional()
  @IsString()
  @IsChileanRut()
  receiverRut?: string;

  @ApiProperty({ example: 'Empresa Cliente SpA', required: false, description: 'Razón social del receptor. Opcional para boletas.' })
  @IsOptional()
  @IsString()
  receiverName?: string;

  @ApiProperty({ example: 'Servicios Informáticos', required: false, description: 'Giro del receptor. Opcional para boletas.' })
  @IsOptional()
  @IsString()
  receiverGiro?: string;

  @ApiProperty({ example: 'Av. Vitacura 1234', required: false, description: 'Dirección del receptor. Opcional para boletas.' })
  @IsOptional()
  @IsString()
  receiverAddress?: string;

  @ApiProperty({ example: 'Vitacura', required: false, description: 'Comuna del receptor' })
  @IsOptional()
  @IsString()
  receiverCommune?: string;

  @ApiProperty({ example: 59500, description: 'Monto total del DTE en CLP' })
  @IsNotEmpty()
  @IsNumber()
  @IsPositive()
  amount: number;

  @ApiProperty({ type: [DteItemDto], description: 'Detalle de ítems del DTE' })
  @IsNotEmpty()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DteItemDto)
  items: DteItemDto[];

  @ApiProperty({ type: [DteReferenceDto], required: false, description: 'Documentos referenciados por este DTE' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DteReferenceDto)
  references?: DteReferenceDto[];

  // ── Campos de boleta ──
  @ApiProperty({ example: 'GROSS', required: false, description: 'Modo de pricing: GROSS (IVA incluido, boletas) o NET (IVA separado). Default: GROSS para boletas, NET para facturas.' })
  @IsOptional()
  @IsString()
  pricingMode?: 'GROSS' | 'NET';

  @ApiProperty({ example: 3, required: false, description: 'IndServicio para boletas: 1=Periódicos, 2=Hogares, 3=No periódicos, 4=Venta interna' })
  @IsOptional()
  @IsNumber()
  indServicio?: number;

  // ── Campos de guía de despacho (T52) ──
  @ApiProperty({ example: 1, required: false, description: 'IndTraslado: 1=Venta, 2=Consignación, 3=Gratuita, 4=Comprobante, 5=Traslado interno, 6=Devolución' })
  @IsOptional()
  @IsNumber()
  indTraslado?: number;

  @ApiProperty({ type: DteTransportDto, required: false, description: 'Modelo de transporte (Resolución SII 154/2025). Obligatorio para T52.' })
  @IsOptional()
  @ValidateNested()
  @Type(() => DteTransportDto)
  transport?: DteTransportDto;

  // ── Campos de factura de compra (T46) ──
  @ApiProperty({ type: [DteTaxRetentionDto], required: false, description: 'Retenciones tributarias (ej. IVA retenido total con TipoImp=15 para T46)' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DteTaxRetentionDto)
  taxRetentions?: DteTaxRetentionDto[];

  // ── Descuento global ──
  @ApiProperty({ example: 19, required: false, description: 'Descuento global a ítems afectos (0-100). Solo facturas.' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  globalDiscountPercentage?: number;

  // ── Campos legacy de transporte (compatibilidad) ──
  @ApiProperty({ example: 'Av. Destino 999', required: false, description: '[Legacy] Dirección destino. Usar transport.destinationAddress en su lugar.' })
  @IsOptional()
  @IsString()
  destAddress?: string;

  @ApiProperty({ example: 'Maipú', required: false, description: '[Legacy] Comuna destino. Usar transport.destinationCommune en su lugar.' })
  @IsOptional()
  @IsString()
  destCommune?: string;

  @ApiProperty({ example: 'Santiago', required: false, description: '[Legacy] Ciudad destino' })
  @IsOptional()
  @IsString()
  destCity?: string;

  @ApiProperty({ example: '12345678-9', required: false, description: '[Legacy] RUT transportista. Usar transport.carrierRut.' })
  @IsOptional()
  @IsString()
  carrierRut?: string;

  @ApiProperty({ example: 'XX-YY-11', required: false, description: '[Legacy] Patente. Usar transport.vehiclePlate.' })
  @IsOptional()
  @IsString()
  vehiclePlate?: string;

  @ApiProperty({ example: 'Juan Pérez', required: false, description: '[Legacy] Nombre chofer. Usar transport.driverName.' })
  @IsOptional()
  @IsString()
  driverName?: string;

  @ApiProperty({ example: 'TRAILER1', required: false, description: '[Legacy] Patente acoplado. Usar transport.trailerPlate.' })
  @IsOptional()
  @IsString()
  trailerPlate?: string;

  @ApiProperty({ example: '2026-08-10', required: false, description: '[Legacy] Fecha salida. Usar transport.departureDate.' })
  @IsOptional()
  @IsString()
  departureDate?: string;

  @ApiProperty({ example: '09:00:00', required: false, description: '[Legacy] Hora salida. Usar transport.departureTime.' })
  @IsOptional()
  @IsString()
  departureTime?: string;

  @ApiProperty({ example: '2026-08-10', required: false, description: '[Legacy] Fecha llegada. Usar transport.arrivalDate.' })
  @IsOptional()
  @IsString()
  arrivalDate?: string;
}
