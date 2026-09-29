import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsString, Matches, MaxLength, ValidateIf, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class UploadCafDto {
  @ApiProperty({ description: 'XML completo <AUTORIZACION> entregado por el SII.' })
  @IsNotEmpty()
  @IsString()
  cafXml: string;
}

export class SaveSignatureDto {
  @ApiProperty({ description: 'Certificado PFX/P12 codificado en base64.' })
  @IsNotEmpty()
  @IsString()
  pfxBase64: string;

  @ApiProperty({ description: 'Contraseña del certificado PFX/P12.' })
  @IsNotEmpty()
  @IsString()
  password: string;
}

export class BrandLogoDto {
  @ApiProperty({ enum: ['image/png', 'image/jpeg'], description: 'Formato real del archivo enviado.' })
  @IsIn(['image/png', 'image/jpeg'])
  mimeType: 'image/png' | 'image/jpeg';

  @ApiProperty({
    description: 'Contenido del logo en base64 estándar, sin prefijo data:. Máximo 700 KB antes de normalizar.',
    maxLength: 955736,
  })
  @IsNotEmpty()
  @IsString()
  @MaxLength(955736)
  base64: string;
}

export class InvoiceBrandLogoMetadataDto {
  @ApiProperty({ enum: ['image/png'], description: 'El logo se normaliza siempre a PNG antes de almacenarse.' })
  mimeType: 'image/png';

  @ApiProperty({ example: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' })
  sha256: string;

  @ApiProperty({ example: 14382, description: 'Tamaño del PNG normalizado en bytes.' })
  bytes: number;
}

export class InvoiceBrandingMetadataDto {
  @ApiProperty({ example: true })
  configured: boolean;

  @ApiProperty({ type: Number, nullable: true, example: 3 })
  version: number | null;

  @ApiProperty({ type: String, nullable: true, example: '#1F4B99' })
  primaryColor: string | null;

  @ApiProperty({ type: String, nullable: true, example: '#5B8DEF' })
  secondaryColor: string | null;

  @ApiProperty({ type: InvoiceBrandLogoMetadataDto, nullable: true })
  logo: InvoiceBrandLogoMetadataDto | null;

  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  createdAt: string | null;
}

export class UpdateInvoiceBrandingDto {
  @ApiProperty({
    type: BrandLogoDto,
    nullable: true,
    description: 'Logo de la nueva versión. Use null para una marca sin logo.',
  })
  @ValidateIf((value) => value.logo !== null)
  @ValidateNested()
  @Type(() => BrandLogoDto)
  logo: BrandLogoDto | null;

  @ApiProperty({ example: '#1F4B99', description: 'Color principal en formato #RRGGBB.' })
  @IsString()
  @Matches(/^#[0-9A-Fa-f]{6}$/, { message: 'primaryColor debe usar el formato #RRGGBB.' })
  primaryColor: string;

  @ApiProperty({ example: '#5B8DEF', description: 'Color secundario en formato #RRGGBB.' })
  @IsString()
  @Matches(/^#[0-9A-Fa-f]{6}$/, { message: 'secondaryColor debe usar el formato #RRGGBB.' })
  secondaryColor: string;
}
