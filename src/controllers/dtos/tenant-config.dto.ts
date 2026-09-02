import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

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
