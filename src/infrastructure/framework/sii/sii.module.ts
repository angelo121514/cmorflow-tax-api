import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataServicesModule } from '../../data-service/data-service.module';
import { Aes256Cipher } from '../crypto/aes-256-cipher';
import { TenantConfigEntity } from '../postgres/entities/tenant-config.entity';
import { SignatureEngine } from './signature.engine';
import { CAFEngine } from './caf.engine';
import { SiiSoapClient } from './sii-soap.client';
import { SiiMockSoap } from './sii-mock.soap';
import { DteXmlBuilder } from './dte-xml.builder';
import { PdfGenerator } from './pdf.generator';
import { SiiEnvironmentConfig } from './sii-environment.config';
import { CafService } from './caf.service';
import { DteXmlEngine } from './dte-xml.engine';
import { SiiAuthTokenService } from './sii-auth-token.service';
import { SiiXsdValidator } from './sii-xsd.validator';
import { TenantConfigService } from './tenant-config.service';
import { DiscountEngine } from './discount.engine';

/**
 * SiiModule reducido para la Tax API: sin libros, sin intercambio de
 * proveedores, sin SiiCertificationModule (forwardRef eliminado).
 * Aes256Cipher se provee desde el módulo de crypto común.
 */
@Module({
  imports: [
    DataServicesModule,
    TypeOrmModule.forFeature([TenantConfigEntity]),
  ],
  providers: [
    Aes256Cipher,
    DiscountEngine,
    SignatureEngine,
    CAFEngine,
    SiiSoapClient,
    SiiMockSoap,
    SiiEnvironmentConfig,
    CafService,
    DteXmlEngine,
    SiiAuthTokenService,
    SiiXsdValidator,
    DteXmlBuilder,
    PdfGenerator,
    TenantConfigService,
  ],
  exports: [
    Aes256Cipher,
    DiscountEngine,
    SignatureEngine,
    CAFEngine,
    SiiSoapClient,
    SiiMockSoap,
    SiiEnvironmentConfig,
    CafService,
    DteXmlEngine,
    SiiAuthTokenService,
    SiiXsdValidator,
    DteXmlBuilder,
    PdfGenerator,
    TenantConfigService,
  ],
})
export class SiiModule {}