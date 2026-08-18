// backend/src/controllers/dtos/create-integration-dte.dto.ts
import {
  IsNotEmpty,
  IsNumber,
  IsString,
  IsArray,
  IsOptional,
  IsIn,
  IsObject,
  IsBoolean,
  IsInt,
  Min,
  Max,
  ValidateNested,
  ValidateIf,
  IsPositive,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { IsChileanRut } from '../../infrastructure/decorators/is-chilean-rut.decorator';
import { DteTransportDto, DteTaxRetentionDto } from './emit-dte.dto';

/** Tipos expuestos por la primera versión de la API B2B. */
export const INTEGRATION_DTE_TYPES = [33, 34, 39, 41, 46, 52, 56, 61];

export class IntegrationReceiverDto {
  @ApiProperty({ example: '76123456-7', description: 'RUT del receptor' })
  @IsNotEmpty()
  @IsString()
  @IsChileanRut()
  rut: string;

  @ApiProperty({ example: 'Empresa Cliente SpA' })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiProperty({ example: 'Servicios Informáticos', required: false })
  @IsOptional()
  @IsString()
  giro?: string;

  @ApiProperty({ example: 'Av. Vitacura 1234', required: false })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiProperty({ example: 'Vitacura', required: false })
  @IsOptional()
  @IsString()
  commune?: string;
}

export class IntegrationItemDto {
  @ApiProperty({ example: 'Consumo de agua - Julio 2026' })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiProperty({ example: 1, description: 'Cantidad (entera o decimal > 0)' })
  @IsNotEmpty()
  @IsNumber()
  @IsPositive()
  quantity: number;

  @ApiProperty({ example: 45000, description: 'Precio unitario CLP (neto o bruto según pricingMode)' })
  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  unitPrice: number;

  @ApiProperty({ example: false, required: false, description: 'Ítem exento (obligatorio true en tipos 34/41)' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  exempt?: boolean;

  @ApiProperty({ example: 10, required: false, description: 'Descuento por línea en % (0-100). Excluyente con discountAmount.' })
  @IsOptional()
  @ValidateIf((o) => !o.discountAmount)
  @IsNumber()
  @Min(0)
  @Max(100)
  discountPercentage?: number;

  @ApiProperty({ example: 250, required: false, description: 'Descuento por línea fijo CLP. Excluyente con discountPercentage.' })
  @IsOptional()
  @ValidateIf((o) => !o.discountPercentage)
  @IsNumber()
  @Min(0)
  discountAmount?: number;
}

export class IntegrationReferenceDto {
  @ApiProperty({ example: 33 })
  @IsNotEmpty()
  @IsNumber()
  type: number;

  @ApiProperty({ example: 154 })
  @IsNotEmpty()
  @IsNumber()
  folio: number;

  @ApiProperty({ example: '2026-06-01' })
  @IsNotEmpty()
  @IsString()
  date: string;

  @ApiProperty({ example: 1, required: false, description: '1=Anula, 2=Corrige texto, 3=Corrige montos' })
  @IsOptional()
  @IsNumber()
  reasonCode?: number;

  @ApiProperty({ example: 'Error de digitación', required: false })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class IntegrationDeclaredTotalsDto {
  @ApiProperty({ example: 380672, required: false })
  @IsOptional()
  @IsNumber()
  netAmount?: number;

  @ApiProperty({ example: 0, required: false })
  @IsOptional()
  @IsNumber()
  exemptAmount?: number;

  @ApiProperty({ example: 72328, required: false })
  @IsOptional()
  @IsNumber()
  ivaAmount?: number;

  @ApiProperty({ example: 453000, required: false, description: 'Si se declara, debe coincidir con el recálculo del servidor (tolerancia $1)' })
  @IsOptional()
  @IsNumber()
  totalAmount?: number;
}

/**
 * Payload público de emisión B2B. Nombres tributarios estables; el tenant se
 * resuelve desde la credencial (cualquier tenantId en el body se rechaza por
 * whitelist estricta del ValidationPipe global).
 */
export class CreateIntegrationDteDto {
  @ApiProperty({ example: 33, description: '33=Factura, 34=Exenta, 39=Boleta, 41=Boleta exenta, 46=Factura compra, 52=Guía (notas 56/61 vía endpoints dedicados)' })
  @IsNotEmpty()
  @IsNumber()
  @IsIn(INTEGRATION_DTE_TYPES)
  documentType: number;

  @ApiProperty({ type: IntegrationReceiverDto, required: false, description: 'Receptor. Obligatorio en 33/34/46/52; opcional en boletas 39/41.' })
  @IsOptional()
  @ValidateNested()
  @Type(() => IntegrationReceiverDto)
  receiver?: IntegrationReceiverDto;

  @ApiProperty({ type: [IntegrationItemDto] })
  @IsNotEmpty()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => IntegrationItemDto)
  items: IntegrationItemDto[];

  @ApiProperty({ type: [IntegrationReferenceDto], required: false })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => IntegrationReferenceDto)
  references?: IntegrationReferenceDto[];

  @ApiProperty({ example: 'GROSS', required: false, description: 'GROSS (IVA incluido) o NET. Default: GROSS en boletas, NET en facturas.' })
  @IsOptional()
  @IsString()
  pricingMode?: 'GROSS' | 'NET';

  @ApiProperty({ example: 3, required: false, description: 'IndServicio boletas' })
  @IsOptional()
  @IsNumber()
  indServicio?: number;

  @ApiProperty({ example: 1, required: false, description: 'IndTraslado para guía 52' })
  @IsOptional()
  @IsNumber()
  indTraslado?: number;

  @ApiProperty({ type: DteTransportDto, required: false, description: 'Transporte. Obligatorio en guía 52 (Res. SII 154/2025).' })
  @IsOptional()
  @ValidateNested()
  @Type(() => DteTransportDto)
  transport?: DteTransportDto;

  @ApiProperty({ type: [DteTaxRetentionDto], required: false, description: 'Retenciones (T46)' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DteTaxRetentionDto)
  taxRetentions?: DteTaxRetentionDto[];

  @ApiProperty({ example: 5, required: false, description: 'Descuento global % a ítems afectos' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  globalDiscountPercentage?: number;

  @ApiProperty({ type: IntegrationDeclaredTotalsDto, required: false, description: 'Totales declarados: el servidor recalcula y valida; divergencia > $1 → 422.' })
  @IsOptional()
  @ValidateNested()
  @Type(() => IntegrationDeclaredTotalsDto)
  totals?: IntegrationDeclaredTotalsDto;

  @ApiProperty({ example: 'APR-CONSUMO-88021', required: false, description: 'Referencia de negocio del integrador, única por tenant. Para anulación/reconciliación.' })
  @IsOptional()
  @IsString()
  externalReference?: string;

  @ApiProperty({ example: { periodoApr: '2026-07', numeroCuenta: 'CTA-88021' }, required: false, description: 'Datos propios del integrador (se repiten en estado y webhooks).' })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}

/** Nota de crédito/débito referenciando un documento original. */
export class CreateIntegrationNoteDto {
  @ApiProperty({ example: 1, description: 'Código de referencia: 1=Anula, 2=Corrige texto, 3=Corrige montos' })
  @IsNotEmpty()
  @IsNumber()
  reasonCode: number;

  @ApiProperty({ example: 'Anula documento por error de emisión' })
  @IsNotEmpty()
  @IsString()
  reason: string;

  @ApiProperty({ type: [IntegrationItemDto], description: 'Líneas de la nota (en anulación: línea simbólica $0).' })
  @IsNotEmpty()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => IntegrationItemDto)
  items: IntegrationItemDto[];

  @ApiProperty({ type: IntegrationDeclaredTotalsDto, required: false })
  @IsOptional()
  @ValidateNested()
  @Type(() => IntegrationDeclaredTotalsDto)
  totals?: IntegrationDeclaredTotalsDto;

  @ApiProperty({ example: 'NC-CONSUMO-88021', required: false })
  @IsOptional()
  @IsString()
  externalReference?: string;

  @ApiProperty({ type: Object, required: false })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}

/** Solicitud RCOF de una fecha. */
export class CreateIntegrationRcofDto {
  @ApiProperty({ example: '2026-08-14', description: 'Fecha del consumo de folios (YYYY-MM-DD)' })
  @IsNotEmpty()
  @IsString()
  date: string;

  @ApiProperty({ example: 1, required: false, description: 'Secuencia del envío (default 1; >1 para reenvíos corregidos)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  sequenceNumber?: number;
}
