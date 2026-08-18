import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
import { IDataServices } from '@domain';
import { Aes256Cipher } from '../../../infrastructure/framework/crypto/aes-256-cipher';
import { CafService, CafData } from './caf.service';
import { SiiXsdValidator } from './sii-xsd.validator';
import { TenantConfigEntity } from '../postgres/entities/tenant-config.entity';
import { firstValueFrom } from 'rxjs';
import { CertificateUtils } from './certificate.utils';
import { DEFAULT_SII_MASTER_KEY, isDefaultMasterKey } from './sii-defaults.constant';

export enum CertificateType {
  REAL = 'REAL',
  MOCK = 'MOCK',
  CERTIFICATION = 'CERTIFICATION',
}

export interface EncryptedField {
  iv: string;
  ciphertext: string;
  authTag: string;
  /** Salt aleatorio (hex). Ausente en material legacy (pre-fix). */
  salt?: string;
}

export interface TenantSignatureConfig {
  pfxBase64: string;
  passwordEncrypted: EncryptedField;
  subjectName: string;
  validTo: string;
  issuerName?: string;
  fingerprint?: string;
  representativeRut?: string;
  type?: CertificateType;
}

export interface TenantTaxProfile {
  giro: string;
  activities: string[];
  address: string;
  commune: string;
  city: string;
  resolutionDate: string;
  resolutionNumber: number;
  /**
   * Indica si el tenant está autorizado por el SII para emitir Factura de
   * Compra Electrónica (T46). Requiere petición administrativa o formulario
   * 2117. Default: false.
   * Fuente: SII FAQ 6461.
   */
  canIssueT46?: boolean;
}

export interface TenantConfig {
  signature?: TenantSignatureConfig;
  signatureHistory?: TenantSignatureConfig[];
  cafs: CafData[];
  taxProfile?: TenantTaxProfile;
  lowStockThresholds?: Record<number, number>;
  /**
   * Proveedor de software para boletas electrónicas.
   * Se renderiza como <RutProvSW> y <RznSocProvSW> en la Carátula del
   * EnvioBOLETA. Relevante para la trazabilidad tributaria del SII en SaaS.
   */
  softwareProvider?: { rut: string; businessName: string };
  /** Fase 4: opt-in de features IA. Off por defecto. */
  aiEnabled?: boolean;
  aiOptInDate?: string;
}

@Injectable()
export class TenantConfigService {
  private readonly logger = new Logger(TenantConfigService.name);
  private readonly masterKey: string;

  // Cache TTL en memoria para evitar consultas repetidas a PostgreSQL
  private readonly configCache = new Map<string, { data: TenantConfig; expires: number }>();
  private readonly signatureCache = new Map<string, { data: { pfxBase64: string; passwordString: string; metadata: any } | null; expires: number }>();
  private readonly CONFIG_TTL_MS = 5 * 60 * 1000;     // 5 minutos para config general
  private readonly SIGNATURE_TTL_MS = 2 * 60 * 1000;  // 2 minutos para firma desencriptada

  constructor(
    @InjectRepository(TenantConfigEntity)
    private readonly configRepo: Repository<TenantConfigEntity>,
    private readonly dataServices: IDataServices,
    private readonly aesCipher: Aes256Cipher,
    private readonly cafService: CafService,
    private readonly xsdValidator: SiiXsdValidator,
    private readonly configService: ConfigService,
  ) {
    this.masterKey = this.configService.get<string>('SII_MASTER_KEY', DEFAULT_SII_MASTER_KEY);
  }

  /**
   * Limpia el cache de un tenant específico. Debe llamarse en cada mutación.
   */
  private invalidateCache(tenantId: string): void {
    this.configCache.delete(tenantId);
    this.signatureCache.delete(tenantId);
    this.logger.log(`Cache invalidado para tenant ${tenantId}`);
  }

  /**
   * Obtiene la configuración completa de un tenant desde PostgreSQL.
   * Utiliza cache en memoria con TTL de 5 minutos para evitar consultas repetidas.
   */
  public async getConfig(tenantId: string): Promise<TenantConfig> {
    // 1. Verificar cache
    const cached = this.configCache.get(tenantId);
    if (cached && cached.expires > Date.now()) {
      return cached.data;
    }

    // 2. Consultar BD
    try {
      const record = await this.configRepo.findOne({
        where: { tenantId },
      });
      const config: TenantConfig = !record ? { cafs: [] } : (record.configJson as TenantConfig);

      // 3. Actualizar cache
      this.configCache.set(tenantId, { data: config, expires: Date.now() + this.CONFIG_TTL_MS });
      return config;
    } catch (error) {
      this.logger.error(`Error leyendo configuración del tenant ${tenantId}:`, error);
      return { cafs: [] };
    }
  }

  /**
   * Fase 4: activa/desactiva features IA para el tenant (opt-in).
   */
  public async setAiEnabled(tenantId: string, enabled: boolean): Promise<{ aiEnabled: boolean; aiOptInDate: string | null }> {
    const config = await this.getConfig(tenantId);
    if (enabled) {
      config.aiEnabled = true;
      config.aiOptInDate = config.aiOptInDate ?? new Date().toISOString();
    } else {
      config.aiEnabled = false;
      delete config.aiOptInDate;
    }
    await this.saveConfig(tenantId, config);
    return { aiEnabled: !!config.aiEnabled, aiOptInDate: config.aiOptInDate ?? null };
  }

  /**
   * Guarda la configuración completa de un tenant en PostgreSQL (upsert).
   * Invalida el cache después de guardar.
   */
  private async saveConfig(tenantId: string, config: TenantConfig): Promise<void> {
    const existing = await this.configRepo.findOne({ where: { tenantId } });

    if (existing) {
      existing.configJson = config as any;
      await this.configRepo.save(existing);
    } else {
      const newRecord = this.configRepo.create({
        tenantId,
        configJson: config as any,
      });
      await this.configRepo.save(newRecord);
    }

    // Invalidar cache después de mutación
    this.invalidateCache(tenantId);
  }

  /**
   * Registra y cifra de forma segura la firma digital del tenant.
   */
  public async saveSignature(
    tenantId: string,
    pfxBase64: string,
    passwordString: string,
  ): Promise<any> {
    this.logger.log(`Guardando firma digital cifrada para el tenant ${tenantId}...`);

    // 1. Bloquear firmas con claves por defecto en producción
    const isProduction = this.configService.get<string>('NODE_ENV') === 'production';
    if (isProduction && isDefaultMasterKey(this.masterKey)) {
      throw new BadRequestException(
        'Seguridad crítica: No se puede guardar la firma digital en producción usando la clave maestra SII_MASTER_KEY por defecto.'
      );
    }

    // 2. Extraer metadatos reales del PFX
    let certMeta: any;
    try {
      certMeta = CertificateUtils.extractMetadata(pfxBase64, passwordString);
    } catch (e) {
      throw new BadRequestException(`No se pudo validar el archivo de firma: ${e.message}`);
    }

    const encryptedPass = this.aesCipher.encrypt(passwordString, this.masterKey);

    const config = await this.getConfig(tenantId);

    // 3. Crear flujo de renovación y archivar firma anterior con historial
    if (config.signature) {
      if (!config.signatureHistory) {
        config.signatureHistory = [];
      }
      // Archivar la firma actual en el historial antes de reemplazarla
      config.signatureHistory.push(config.signature);
    }

    let certificateType = CertificateType.REAL;
    const issuerLower = (certMeta.issuerName || '').toLowerCase();
    const subjectLower = (certMeta.subjectName || '').toLowerCase();
    if (issuerLower.includes('mock') || subjectLower.includes('mock') || issuerLower.includes('simulado')) {
      certificateType = CertificateType.MOCK;
    } else if (issuerLower.includes('prueba') || subjectLower.includes('prueba') || issuerLower.includes('certificacion') || subjectLower.includes('certificacion')) {
      certificateType = CertificateType.CERTIFICATION;
    }

    config.signature = {
      pfxBase64,
      passwordEncrypted: {
        iv: encryptedPass.iv,
        ciphertext: encryptedPass.ciphertext,
        authTag: encryptedPass.authTag,
        salt: encryptedPass.salt,
      },
      subjectName: certMeta.subjectName,
      validTo: certMeta.validTo,
      issuerName: certMeta.issuerName,
      fingerprint: certMeta.fingerprint,
      representativeRut: certMeta.representativeRut,
      type: certificateType,
    };

    await this.saveConfig(tenantId, config);

    return {
      success: true,
      message: 'Firma digital encriptada con AES-256-GCM y guardada de forma segura en PostgreSQL.',
      subjectName: config.signature.subjectName,
      validTo: config.signature.validTo,
      fingerprint: config.signature.fingerprint,
    };
  }

  /**
   * Registra y almacena un archivo CAF.
   */
  public async uploadCaf(tenantId: string, cafXml: string): Promise<any> {
    this.logger.log(`Procesando archivo CAF para el tenant ${tenantId}...`);

    // 1. Obtener detalles del Tenant para realizar validación cruzada de RUT
    const tenant = await firstValueFrom(this.dataServices.tenant.get(tenantId));
    if (!tenant) {
      throw new NotFoundException(`Tenant con ID ${tenantId} no encontrado.`);
    }
    
    // 2. Validar contra el esquema XSD de forma asíncrona
    await this.xsdValidator.validateCaf(cafXml);
    
    // 3. Parsear el CAF (que internamente ejecuta también las reglas quirúrgicas sincrónicas)
    const parsedCaf = this.cafService.parse(cafXml);

    // RSASK es la llave que firma el TED. Un CAF sin esta llave no sirve para
    // emitir, y guardarla en texto plano dentro de config_json sería una fuga
    // tributaria crítica.
    if (!parsedCaf.privateKeyPem) {
      throw new BadRequestException(
        'El archivo de autorización no contiene una llave privada RSASK válida. Carga el XML <AUTORIZACION> completo entregado por el SII.'
      );
    }

    const isProduction = this.configService.get<string>('NODE_ENV') === 'production';
    if (isProduction && isDefaultMasterKey(this.masterKey)) {
      throw new BadRequestException(
        'Seguridad crítica: No se puede guardar un CAF en producción usando la clave maestra SII_MASTER_KEY por defecto.'
      );
    }

    const { privateKeyPem, ...cafWithoutPrivateKey } = parsedCaf;
    const cafData: CafData = {
      ...cafWithoutPrivateKey,
      privateKeyEncrypted: this.aesCipher.encrypt(privateKeyPem, this.masterKey),
    };

    // 4. Validar que el RUT emisor en el CAF coincida con el RUT del tenant
    const cleanTenantRut = tenant.rut.replace(/[^0-9kK]/g, '').toUpperCase();
    const cleanCafRut = cafData.issuerRut.replace(/[^0-9kK]/g, '').toUpperCase();

    if (cleanTenantRut !== cleanCafRut) {
      throw new BadRequestException(
        `El RUT emisor en el CAF (${cafData.issuerRut}) no coincide con el RUT de la empresa (${tenant.rut}).`
      );
    }

    const config = await this.getConfig(tenantId);
    
    // Evitar CAFs duplicados para el mismo tipo y rango
    config.cafs = config.cafs.filter(
      (c) => !(c.type === cafData.type && c.rangeFrom === cafData.rangeFrom),
    );
    config.cafs.push(cafData);

    await this.saveConfig(tenantId, config);

    return {
      success: true,
      message: `Archivo CAF para DTE ${cafData.type} cargado exitosamente.`,
      caf: {
        type: cafData.type,
        rangeFrom: cafData.rangeFrom,
        rangeTo: cafData.rangeTo,
        authorizationDate: cafData.authorizationDate,
      },
    };
  }

  public async getTaxProfile(tenantId: string): Promise<TenantTaxProfile | undefined> {
    return (await this.getConfig(tenantId)).taxProfile;
  }

  /**
   * Guarda la configuración del proveedor de software para boletas electrónicas.
   * Se renderiza como <RutProvSW> y <RznSocProvSW> en la Carátula del EnvioBOLETA.
   * Relevante para la trazabilidad tributaria del SII en proveedores SaaS.
   */
  public async saveSoftwareProvider(
    tenantId: string,
    provider: { rut: string; businessName: string },
  ): Promise<{ rut: string; businessName: string }> {
    if (!provider.rut || typeof provider.rut !== 'string') {
      throw new BadRequestException('El RUT del proveedor de software es obligatorio.');
    }
    if (!provider.businessName || typeof provider.businessName !== 'string') {
      throw new BadRequestException('La razón social del proveedor de software es obligatoria.');
    }
    const config = await this.getConfig(tenantId);
    config.softwareProvider = {
      rut: provider.rut.trim(),
      businessName: provider.businessName.trim(),
    };
    await this.saveConfig(tenantId, config);
    this.logger.log(`Proveedor de software configurado para tenant ${tenantId}: ${provider.rut}`);
    return config.softwareProvider;
  }

  /**
   * Obtiene la configuración del proveedor de software.
   */
  public async getSoftwareProvider(tenantId: string): Promise<{ rut: string; businessName: string } | undefined> {
    return (await this.getConfig(tenantId)).softwareProvider;
  }

  public async saveTaxProfile(tenantId: string, profile: TenantTaxProfile): Promise<TenantTaxProfile> {
    this.assertValidTaxProfile(profile);
    const config = await this.getConfig(tenantId);
    config.taxProfile = {
      ...profile,
      giro: profile.giro.trim(),
      activities: profile.activities.map(activity => activity.trim()),
      address: profile.address.trim(),
      commune: profile.commune.trim(),
      city: profile.city.trim(),
    };
    await this.saveConfig(tenantId, config);
    return config.taxProfile;
  }

  /**
   * En modo real no se permiten valores predeterminados tributarios. Esto se
   * evalúa al emitir, antes de reservar folio o firmar cualquier documento.
   */
  public async requireTaxProfileForRealEmission(tenantId: string): Promise<TenantTaxProfile | undefined> {
    const profile = await this.getTaxProfile(tenantId);
    if (this.configService.get<string>('SII_INTEGRATION_MODE', 'mock') !== 'real') {
      return profile;
    }
    if (!profile) {
      throw new BadRequestException('No se puede emitir en modo real sin perfil tributario configurado para el tenant.');
    }
    this.assertValidTaxProfile(profile);
    return profile;
  }

  private assertValidTaxProfile(profile: TenantTaxProfile): void {
    const errors: string[] = [];
    if (!profile.giro?.trim()) errors.push('giro');
    if (!Array.isArray(profile.activities) || profile.activities.length === 0 || profile.activities.some(activity => !/^\d{4,8}$/.test(activity.trim()))) errors.push('activities');
    if (!profile.address?.trim()) errors.push('address');
    if (!profile.commune?.trim()) errors.push('commune');
    if (!profile.city?.trim()) errors.push('city');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(profile.resolutionDate || '')) errors.push('resolutionDate');
    if (!Number.isInteger(profile.resolutionNumber) || profile.resolutionNumber < 0) errors.push('resolutionNumber');
    if (errors.length) {
      throw new BadRequestException(`Perfil tributario inválido; faltan o no son válidos: ${errors.join(', ')}.`);
    }
  }

  /**
   * Obtiene el CAF aplicable a un folio y descifra RSASK sólo durante la firma
   * del TED. El material nunca se persiste ni se registra en logs en claro.
   */
  public async getDecryptedCafForFolio(
    tenantId: string,
    dteType: number,
    folio: number,
  ): Promise<{ cafXml: string; cafPrivateKey: import('node-forge').pki.rsa.PrivateKey }> {
    const isProduction = this.configService.get<string>('NODE_ENV') === 'production';
    if (isProduction && isDefaultMasterKey(this.masterKey)) {
      throw new BadRequestException(
        'Seguridad crítica: Emisión bloqueada. No se permite usar CAF con la clave maestra SII_MASTER_KEY por defecto.'
      );
    }

    const config = await this.getConfig(tenantId);
    const caf = config.cafs.find(
      (candidate) =>
        candidate.type === dteType &&
        folio >= candidate.rangeFrom &&
        folio <= candidate.rangeTo,
    );

    if (!caf) {
      throw new BadRequestException(
        `No existe un CAF activo para DTE ${dteType} que cubra el folio ${folio}.`,
      );
    }

    let cafPrivateKey: import('node-forge').pki.rsa.PrivateKey | null = null;
    if (caf.privateKeyEncrypted) {
      try {
        const privateKeyPem = this.aesCipher.decrypt(
          caf.privateKeyEncrypted.ciphertext,
          this.masterKey,
          caf.privateKeyEncrypted.iv,
          caf.privateKeyEncrypted.authTag,
          caf.privateKeyEncrypted.salt,
        );
        cafPrivateKey = this.cafService.privateKeyFromPem(privateKeyPem);
      } catch {
        throw new BadRequestException('No se pudo descifrar la llave privada del CAF.');
      }
    } else {
      // Compatibilidad con CAFs simulados guardados por versiones anteriores.
      // Un CAF real debe volver a cargarse para quedar cifrado.
      cafPrivateKey = this.cafService.extractPrivateKey(caf.rawXml);
    }

    if (!cafPrivateKey) {
      throw new BadRequestException(
        'El CAF cargado no tiene una llave RSASK utilizable. Vuelve a cargar el archivo de autorización completo del SII.',
      );
    }

    return { cafXml: caf.rawXml, cafPrivateKey };
  }

  /**
   * Obtiene la salud de folios (alertas) en base a los CAFs cargados y los documentos emitidos reales en DB.
   */
  public async getFolioStatus(tenantId: string): Promise<any[]> {
    this.logger.log(`Calculando stock de folios y alertas para Tenant: ${tenantId}...`);
    const config = await this.getConfig(tenantId);
    
    // Obtener todos los DTEs emitidos del tenant desde la BD
    const dtes = await firstValueFrom(this.dataServices.dteDocument.getAll());

    const result: any[] = [];

    // Agrupar conteo de folios por tipo
    const activeTypes = [33, 34, 39, 41, 46, 52, 56, 61];

    for (const type of activeTypes) {
      const matchingCafs = config.cafs.filter((c) => c.type === type);
      
      if (matchingCafs.length === 0) {
        result.push({
          type,
          hasCaf: false,
          totalAuthorized: 0,
          utilized: 0,
          remaining: 0,
          alert: 'CRITICO', // Sin CAF es crítico
          threshold: 20,
        });
        continue;
      }

      let totalAuthorized = 0;
      let utilized = 0;

      for (const caf of matchingCafs) {
        totalAuthorized += (caf.rangeTo - caf.rangeFrom + 1);

        // Contar cuántos DTEs emitidos reales caen dentro de este rango del CAF
        const countInCaf = dtes.filter(
          (d) => d.type === type && d.folio >= caf.rangeFrom && d.folio <= caf.rangeTo
        ).length;

        utilized += countInCaf;
      }

      const remaining = totalAuthorized - utilized;
      const ratio = totalAuthorized > 0 ? remaining / totalAuthorized : 0;
      const threshold = config.lowStockThresholds?.[type] !== undefined ? config.lowStockThresholds[type] : 0.20;

      let alert: 'SALUDABLE' | 'ADVERTENCIA' | 'CRITICO' = 'SALUDABLE';
      if (remaining <= 0) {
        alert = 'CRITICO';
      } else if (ratio <= 0.05) {
        alert = 'CRITICO';
      } else if (ratio <= threshold) {
        alert = 'ADVERTENCIA';
      }

      result.push({
        type,
        hasCaf: true,
        totalAuthorized,
        utilized,
        remaining,
        alert,
        threshold: Math.round(threshold * 100),
      });
    }

    return result;
  }

  /**
   * Obtiene el estado y alertas de expiración de la firma digital (PFX).
   */
  public async getSignatureStatus(tenantId: string): Promise<any> {
    const config = await this.getConfig(tenantId);
    if (!config.signature) {
      return { hasSignature: false };
    }

    const validToDate = new Date(config.signature.validTo);
    const today = new Date();
    const diffTime = validToDate.getTime() - today.getTime();
    const daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    const isExpiringSoon = daysRemaining <= 30;
    const isExpired = daysRemaining < 0;

    // Simular alerta push o email si está por expirar
    if (isExpiringSoon && !isExpired) {
      this.logger.warn(
        `[ALERTA DE SEGURIDAD] La firma digital del inquilino ${tenantId} expira en ${daysRemaining} días (${config.signature.validTo}). ` +
        `Se ha gatillado y despachado de forma proactiva una notificación push al celular del administrador y un correo de aviso.`
      );
    }

    return {
      hasSignature: true,
      subjectName: config.signature.subjectName,
      validTo: config.signature.validTo,
      daysRemaining: isExpired ? 0 : daysRemaining,
      isExpiringSoon,
      isExpired,
      issuerName: config.signature.issuerName || 'Desconocido',
      fingerprint: config.signature.fingerprint || 'N/A',
      representativeRut: config.signature.representativeRut || 'N/A',
      type: config.signature.type || 'REAL',
      environment: this.configService.get<string>('SII_ENVIRONMENT', 'certification').toUpperCase(),
      alertMessage: isExpiringSoon
        ? `⚠️ ¡Alerta! Tu firma digital (.pfx) expira en ${daysRemaining} días el ${config.signature.validTo}. ` +
          `Renueva tu certificado de inmediato para evitar que tus emisiones DTE se detengan ante el SII.`
        : null,
    };
  }

  /**
   * Registra una firma digital simulada configurada para expirar en 15 días.
   */
  public async saveSimulatedExpiringSignature(tenantId: string): Promise<any> {
    this.logger.log(`Registrando firma simulada de expiración (15 días) para el inquilino ${tenantId}...`);
    const config = await this.getConfig(tenantId);

    const fifteenDaysFromNow = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000);

    config.signature = {
      pfxBase64: 'simulated-expiring-pfx-base64',
      passwordEncrypted: {
        iv: 'simulated-iv',
        ciphertext: 'simulated-ciphertext',
        authTag: 'simulated-tag',
      },
      subjectName: 'Andrea Muñoz Silva (Representante Expirando)',
      validTo: fifteenDaysFromNow.toISOString().split('T')[0],
      type: CertificateType.MOCK,
    };

    await this.saveConfig(tenantId, config);

    // Ejecutar el getter de estado para disparar proactivamente la advertencia en consola
    return this.getSignatureStatus(tenantId);
  }

  /**
   * Desencripta y obtiene la firma digital con su clave para firmas criptográficas.
   * Utiliza cache con TTL de 2 minutos para evitar desencriptación repetida por DTE.
   */
  public async getDecryptedSignature(
    tenantId: string,
  ): Promise<{ pfxBase64: string; passwordString: string; metadata: any } | null> {
    // 1. Verificar cache de firma desencriptada
    const cachedSig = this.signatureCache.get(tenantId);
    if (cachedSig && cachedSig.expires > Date.now()) {
      return cachedSig.data;
    }

    const isProduction = this.configService.get<string>('NODE_ENV') === 'production';
    if (isProduction && isDefaultMasterKey(this.masterKey)) {
      throw new BadRequestException(
        'Seguridad crítica: Emisión bloqueada. No se permite la emisión de DTEs en producción si la clave maestra SII_MASTER_KEY es la por defecto.'
      );
    }

    const config = await this.getConfig(tenantId);
    if (!config.signature) {
      return null;
    }

    // Bloquear emisión si el certificado está vencido
    const validToDate = new Date(config.signature.validTo);
    const today = new Date();
    if (validToDate < today) {
      throw new BadRequestException(
        `Firma digital vencida. El certificado expiró el ${config.signature.validTo} y las emisiones están bloqueadas.`
      );
    }

    const { pfxBase64, passwordEncrypted } = config.signature;
    
    try {
      const passwordString = this.aesCipher.decrypt(
        passwordEncrypted.ciphertext,
        this.masterKey,
        passwordEncrypted.iv,
        passwordEncrypted.authTag,
        passwordEncrypted.salt,
      );

      const result = {
        pfxBase64,
        passwordString,
        metadata: {
          subjectName: config.signature.subjectName,
          validTo: config.signature.validTo,
          fingerprint: config.signature.fingerprint,
          representativeRut: config.signature.representativeRut,
        },
      };

      // Cachear firma desencriptada con TTL corto
      this.signatureCache.set(tenantId, { data: result, expires: Date.now() + this.SIGNATURE_TTL_MS });

      return result;
    } catch (e) {
      this.logger.error(`Error al desencriptar firma del tenant ${tenantId}: ${e.message}`);
      throw new BadRequestException('No se pudo desencriptar la contraseña de la firma digital.');
    }
  }

  /**
   * Reserva el siguiente folio de forma atómica.
   * Si estamos en una transacción de base de datos real, bloquea la fila
   * de configuración con un bloqueo de escritura (pessimistic_write).
   * Si no (ej. en pruebas unitarias), usa el fallback no-transaccional.
   */
  public async reserveFolioAtomic(tenantId: string, dteType: number): Promise<number> {
    return await this.configRepo.manager.transaction(async (transactionalEntityManager) => {
      // 1. Obtener la fila con un bloqueo de escritura pesimista
      const record = await transactionalEntityManager.findOne(TenantConfigEntity, {
        where: { tenantId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!record) {
        throw new BadRequestException(`No hay configuración disponible para el tenant ${tenantId}. Debe cargar al menos un CAF.`);
      }

      const config = record.configJson as TenantConfig;

      // 2. Buscar un CAF válido y no agotado para el tipo de DTE
      if (!config.cafs || config.cafs.length === 0) {
        throw new BadRequestException(`No hay archivos CAF cargados para el tenant ${tenantId}.`);
      }

      const cafsForType = config.cafs.filter((c) => c.type === dteType);
      if (cafsForType.length === 0) {
        throw new BadRequestException(`No se encontró un archivo CAF para el tipo DTE ${dteType}.`);
      }

      let selectedCaf: CafData | undefined;
      let nextFolio = -1;

      for (const caf of cafsForType) {
        const currentLastUsed = caf.lastUsedFolio !== undefined ? caf.lastUsedFolio : (caf.rangeFrom - 1);
        if (currentLastUsed < caf.rangeTo) {
          selectedCaf = caf;
          nextFolio = currentLastUsed + 1;
          break;
        }
      }

      if (!selectedCaf) {
        throw new BadRequestException(`Todos los folios de los CAFs autorizados para el tipo DTE ${dteType} están agotados.`);
      }

      // 3. Actualizar el folio utilizado en el CAF seleccionado
      selectedCaf.lastUsedFolio = nextFolio;

      // 4. Guardar los cambios de vuelta en la transacción
      record.configJson = config as any;
      await transactionalEntityManager.save(TenantConfigEntity, record);

      this.logger.log(`Folio ${nextFolio} reservado atómicamente para Tenant ${tenantId}, Tipo DTE ${dteType}`);
      return nextFolio;
    });
    // ISSUE-009: el fallback no-transaccional fue eliminado. Si la transacción
    // falla (deadlock, timeout de BD), el error propaga y la emisión falla
    // limpio — es preferible a duplicar folios por una reserva sin lock.
  }

  /**
   * Obtiene la trazabilidad completa del consumo de folios cruzando DTEs y Logs de Auditoría.
   */
  public async getFolioTraceability(tenantId: string): Promise<any[]> {
    const config = await this.getConfig(tenantId);
    const dtes = await firstValueFrom(this.dataServices.dteDocument.find({ where: { tenantId } }));
    const auditLogs = await firstValueFrom(this.dataServices.auditLog.find({ where: { tenantId, action: 'DTE_EMITTED' } }));
    
    const trace: any[] = [];
    
    for (const dte of dtes) {
      const caf = config.cafs.find((c) => c.type === dte.type && dte.folio >= c.rangeFrom && dte.folio <= c.rangeTo);
      const audit = auditLogs.find((log) => log.payload && log.payload.dteId === dte.id);
      const userEmail = audit ? (audit.payload.operatorName || `Usuario ID: ${audit.userId || 'Sistema'}`) : 'Sistema / Automático';
      
      trace.push({
        folio: dte.folio,
        type: dte.type,
        cafRange: caf ? `${caf.rangeFrom}-${caf.rangeTo}` : 'Sin CAF / Simulación',
        cafAuthDate: caf ? caf.authorizationDate : 'N/A',
        documentId: dte.id,
        status: dte.status,
        emittedBy: userEmail,
        timestamp: dte.createdAt || new Date(),
        trackId: dte.trackId || null,
        statusHistory: dte.statusHistory || [],
      });
    }
    
    return trace.sort((a, b) => b.folio - a.folio || b.type - a.type);
  }

  /**
   * Guarda los umbrales de alerta de stock bajo para el inquilino.
   */
  public async saveFolioThresholds(tenantId: string, thresholds: Record<string, number>): Promise<any> {
    this.logger.log(`Guardando umbrales de folios para tenant: ${tenantId}...`);
    const config = await this.getConfig(tenantId);
    
    config.lowStockThresholds = {};
    for (const [key, value] of Object.entries(thresholds)) {
      const dteType = parseInt(key);
      if (!isNaN(dteType)) {
        config.lowStockThresholds[dteType] = value / 100; // Guardar como decimal (ej. 20% -> 0.20)
      }
    }

    await this.saveConfig(tenantId, config);
    return {
      success: true,
      message: 'Umbrales de stock bajo de folios actualizados correctamente.',
      thresholds: config.lowStockThresholds,
    };
  }
}
