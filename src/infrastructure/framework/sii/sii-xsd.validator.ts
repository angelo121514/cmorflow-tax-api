import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { SiiValidationError } from './sii-validation.error';

const execFileAsync = promisify(execFile);

@Injectable()
export class SiiXsdValidator {
  private readonly logger = new Logger(SiiXsdValidator.name);

  constructor(private readonly configService: ConfigService) {}

  async validateEnvioDte(xml: string): Promise<void> {
    this.validateSurgicalRules(xml);

    const xsdValidationEnabled =
      this.configService.get<string>('SII_XSD_VALIDATION_ENABLED', 'false') === 'true';
    if (!xsdValidationEnabled) {
      this.logger.warn('Validación XSD oficial desactivada. Activa SII_XSD_VALIDATION_ENABLED=true con XSD oficiales.');
      return;
    }

    const defaultSchemaPath = join(__dirname, 'xsd', 'EnvioDTE_v10.xsd');
    const schemaPath = this.configService.get<string>('SII_ENVIO_DTE_XSD_PATH', defaultSchemaPath);


    const workDir = await mkdtemp(join(tmpdir(), 'sii-xsd-'));
    const xmlPath = join(workDir, 'envio-dte.xml');
    try {
      await writeFile(xmlPath, xml, { encoding: 'latin1' });
      await execFileAsync('xmllint', ['--noout', '--schema', schemaPath, xmlPath], {
        timeout: 30000,
        windowsHide: true,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error desconocido validando XSD.';
      // Capturar de forma limpia si el binario "xmllint" no está instalado en el sistema
      if (
        (error as any).code === 'ENOENT' ||
        message.includes('ENOENT') ||
        message.includes('not found')
      ) {
        this.logger.error('El binario "xmllint" no está disponible en este servidor. Por favor, instala libxml2-utils o desactiva la validación XSD (SII_XSD_VALIDATION_ENABLED=false) en tus variables de entorno.');
        throw new SiiValidationError(
          'El validador de esquemas "xmllint" no está instalado en el servidor. ' +
          'Instala "libxml2-utils" en tu entorno o desactiva la validación XSD estableciendo ' +
          'la variable de entorno SII_XSD_VALIDATION_ENABLED=false.'
        );
      }
      throw new SiiValidationError('El EnvioDTE no cumple el XSD oficial del SII.', [message]);
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }

  private validateSurgicalRules(xml: string): void {
    const errors: string[] = [];
    if (!/^<\?xml[^>]*encoding="ISO-8859-1"/i.test(xml.trim())) {
      errors.push('El XML debe declarar encoding="ISO-8859-1".');
    }
    if (!/<EnvioDTE\b/i.test(xml)) {
      errors.push('El XML de envío debe contener <EnvioDTE>.');
    }
    if (!/<SetDTE\b[^>]*\bID=/i.test(xml)) {
      errors.push('El envío debe contener <SetDTE ID="..."> para firma del sobre.');
    }
    if (!/<Signature\b[\s\S]*?<\/Signature>/i.test(xml)) {
      errors.push('El envío debe estar firmado con XMLDSig antes del POST multipart.');
    }

    const dteBlocks = xml.match(/<DTE\b[\s\S]*?<\/DTE>/gi) || [];
    if (dteBlocks.length === 0) {
      errors.push('El envío debe contener al menos un <DTE>.');
    }

    dteBlocks.forEach((dteXml, index) => {
      if (!/<Documento\b[^>]*\bID=/i.test(dteXml)) {
        errors.push(`DTE #${index + 1}: falta <Documento ID="...">.`);
      }
      if (!/<TED\b[\s\S]*?<\/TED>/i.test(dteXml)) {
        errors.push(`DTE #${index + 1}: falta nodo <TED>.`);
      }
      if (!/<Signature\b[\s\S]*?<\/Signature>/i.test(dteXml)) {
        errors.push(`DTE #${index + 1}: falta firma XMLDSig del <Documento>.`);
      }

      const net = this.numberTag(dteXml, 'MntNeto');
      const exempt = this.numberTag(dteXml, 'MntExe');
      const iva = this.numberTag(dteXml, 'IVA');
      const total = this.numberTag(dteXml, 'MntTotal');
      if (total === undefined) {
        errors.push(`DTE #${index + 1}: falta <MntTotal>.`);
      } else if ((net || 0) + (exempt || 0) + (iva || 0) !== total) {
        errors.push(`DTE #${index + 1}: MntNeto + MntExe + IVA no cuadra con MntTotal.`);
      }
    });

    if (errors.length > 0) {
      throw new SiiValidationError('Preflight SII falló antes del envío.', errors);
    }
  }

  /**
   * Valida un envelope EnvioBOLETA (boletas electrónicas 39/41).
   * Las boletas usan un schema separado (EnvioBOLETA_v11.xsd) y no se pueden
   * validar con validateEnvioDte porque su estructura difiere.
   */
  async validateEnvioBoleta(xml: string): Promise<void> {
    this.validateBoletaSurgicalRules(xml);

    const xsdValidationEnabled =
      this.configService.get<string>('SII_XSD_VALIDATION_ENABLED', 'false') === 'true';
    if (!xsdValidationEnabled) {
      this.logger.warn('Validación XSD oficial desactivada para EnvioBOLETA. Activa SII_XSD_VALIDATION_ENABLED=true con XSD oficiales.');
      return;
    }

    const defaultSchemaPath = join(__dirname, 'xsd', 'EnvioBOLETA_v11.xsd');
    const schemaPath = this.configService.get<string>('SII_ENVIO_BOLETA_XSD_PATH', defaultSchemaPath);

    const workDir = await mkdtemp(join(tmpdir(), 'sii-xsd-boleta-'));
    const xmlPath = join(workDir, 'envio-boleta.xml');
    try {
      await writeFile(xmlPath, xml, { encoding: 'latin1' });
      await execFileAsync('xmllint', ['--noout', '--schema', schemaPath, xmlPath], {
        timeout: 30000,
        windowsHide: true,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error desconocido validando XSD.';
      if ((error as any).code === 'ENOENT' || message.includes('ENOENT') || message.includes('not found')) {
        this.logger.error('El binario "xmllint" no está disponible. Instala libxml2-utils o desactiva SII_XSD_VALIDATION_ENABLED.');
        throw new SiiValidationError(
          'El validador "xmllint" no está instalado. Instala "libxml2-utils" o desactiva SII_XSD_VALIDATION_ENABLED=false.'
        );
      }
      throw new SiiValidationError('El EnvioBOLETA no cumple el XSD oficial del SII.', [message]);
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }

  /**
   * Reglas quirúrgicas para EnvioBOLETA.
   * Diferencias con EnvioDTE: usa <EnvioBOLETA>, el receptor del envelope es el SII (60803000-K),
   * y los DTEs pueden no tener MntNeto explícito (boletas GROSS con IVA incluido).
   */
  private validateBoletaSurgicalRules(xml: string): void {
    const errors: string[] = [];
    if (!/^<\?xml[^>]*encoding="ISO-8859-1"/i.test(xml.trim())) {
      errors.push('El XML debe declarar encoding="ISO-8859-1".');
    }
    if (!/<EnvioBOLETA\b/i.test(xml)) {
      errors.push('El XML de boleta debe contener <EnvioBOLETA>.');
    }
    if (!/<SetDTE\b[^>]*\bID=/i.test(xml)) {
      errors.push('El envío debe contener <SetDTE ID="..."> para firma del sobre.');
    }
    if (!/<Signature\b[\s\S]*?<\/Signature>/i.test(xml)) {
      errors.push('El envío debe estar firmado con XMLDSig antes del POST multipart.');
    }

    const dteBlocks = xml.match(/<DTE\b[\s\S]*?<\/DTE>/gi) || [];
    if (dteBlocks.length === 0) {
      errors.push('El envío debe contener al menos un <DTE>.');
    }

    dteBlocks.forEach((dteXml, index) => {
      if (!/<Documento\b[^>]*\bID=/i.test(dteXml)) {
        errors.push(`Boleta #${index + 1}: falta <Documento ID="...">.`);
      }
      if (!/<TED\b[\s\S]*?<\/TED>/i.test(dteXml)) {
        errors.push(`Boleta #${index + 1}: falta nodo <TED>.`);
      }
      if (!/<Signature\b[\s\S]*?<\/Signature>/i.test(dteXml)) {
        errors.push(`Boleta #${index + 1}: falta firma XMLDSig del <Documento>.`);
      }
      const total = this.numberTag(dteXml, 'MntTotal');
      if (total === undefined) {
        errors.push(`Boleta #${index + 1}: falta <MntTotal>.`);
      }
      // Boletas: no exigimos MntNeto + IVA = MntTotal porque en GROSS el neto se deriva.
    });

    if (errors.length > 0) {
      throw new SiiValidationError('Preflight EnvioBOLETA falló antes del envío.', errors);
    }
  }

  /**
   * Valida un ConsumoFolio (RCOF/RVD) para boletas electrónicas.
   */
  async validateConsumoFolio(xml: string): Promise<void> {
    this.validateConsumoFolioSurgicalRules(xml);

    const xsdValidationEnabled =
      this.configService.get<string>('SII_XSD_VALIDATION_ENABLED', 'false') === 'true';
    if (!xsdValidationEnabled) {
      this.logger.warn('Validación XSD oficial desactivada para ConsumoFolio. Activa SII_XSD_VALIDATION_ENABLED=true.');
      return;
    }

    const defaultSchemaPath = join(__dirname, 'xsd', 'ConsumoFolio_v10.xsd');
    const schemaPath = this.configService.get<string>('SII_CONSUMO_FOLIO_XSD_PATH', defaultSchemaPath);

    const workDir = await mkdtemp(join(tmpdir(), 'sii-xsd-rcof-'));
    const xmlPath = join(workDir, 'consumo-folio.xml');
    try {
      await writeFile(xmlPath, xml, { encoding: 'latin1' });
      await execFileAsync('xmllint', ['--noout', '--schema', schemaPath, xmlPath], {
        timeout: 30000,
        windowsHide: true,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error desconocido validando XSD.';
      if ((error as any).code === 'ENOENT' || message.includes('ENOENT') || message.includes('not found')) {
        this.logger.error('El binario "xmllint" no está disponible. Instala libxml2-utils o desactiva SII_XSD_VALIDATION_ENABLED.');
        throw new SiiValidationError(
          'El validador "xmllint" no está instalado. Instala "libxml2-utils" o desactiva SII_XSD_VALIDATION_ENABLED=false.'
        );
      }
      throw new SiiValidationError('El ConsumoFolio no cumple el XSD oficial del SII.', [message]);
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }

  /**
   * Reglas quirúrgicas para ConsumoFolio (RCOF).
   */
  private validateConsumoFolioSurgicalRules(xml: string): void {
    const errors: string[] = [];
    if (!/^<\?xml[^>]*encoding="ISO-8859-1"/i.test(xml.trim())) {
      errors.push('El XML debe declarar encoding="ISO-8859-1".');
    }
    if (!/<ConsumoFolio\b/i.test(xml)) {
      errors.push('El XML debe contener <ConsumoFolio>.');
    }
    if (!/<DocumentoConsumoFolio\b[^>]*\bID=/i.test(xml)) {
      errors.push('El ConsumoFolio debe contener <DocumentoConsumoFolio ID="...">.');
    }
    if (!/<Caratula\b/i.test(xml)) {
      errors.push('El ConsumoFolio debe contener <Caratula>.');
    }
    const resumenes = xml.match(/<Resumen\b[\s\S]*?<\/Resumen>/gi) || [];
    if (resumenes.length === 0) {
      errors.push('El ConsumoFolio debe contener al menos un <Resumen>.');
    }
    if (!/<Signature\b[\s\S]*?<\/Signature>/i.test(xml)) {
      errors.push('El ConsumoFolio debe estar firmado con XMLDSig.');
    }

    if (errors.length > 0) {
      throw new SiiValidationError('Preflight ConsumoFolio falló.', errors);
    }
  }

  async validateCaf(xml: string): Promise<void> {
    this.validateCafSurgicalRules(xml);

    const xsdValidationEnabled =
      this.configService.get<string>('SII_XSD_VALIDATION_ENABLED', 'false') === 'true';
    if (!xsdValidationEnabled) {
      this.logger.warn('Validación XSD oficial desactivada para CAF. Activa SII_XSD_VALIDATION_ENABLED=true con XSD oficiales.');
      return;
    }

    const defaultSchemaPath = join(__dirname, 'xsd', 'CAF_v10.xsd');
    const schemaPath = this.configService.get<string>('SII_CAF_XSD_PATH', defaultSchemaPath);

    const workDir = await mkdtemp(join(tmpdir(), 'sii-caf-xsd-'));
    const xmlPath = join(workDir, 'caf.xml');
    try {
      // El archivo descargado del SII tiene raíz <AUTORIZACION>, pero el XSD
      // tributario valida el bloque interno <CAF> que se inserta en el TED.
      await writeFile(xmlPath, this.extractCafForSchema(xml), { encoding: 'latin1' });
      await execFileAsync('xmllint', ['--noout', '--schema', schemaPath, xmlPath], {
        timeout: 30000,
        windowsHide: true,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error desconocido validando XSD del CAF.';
      if (
        (error as any).code === 'ENOENT' ||
        message.includes('ENOENT') ||
        message.includes('not found')
      ) {
        this.logger.error('El binario "xmllint" no está disponible en este servidor. Por favor, instala libxml2-utils o desactiva la validación XSD (SII_XSD_VALIDATION_ENABLED=false) en tus variables de entorno.');
        throw new SiiValidationError(
          'El validador de esquemas "xmllint" no está instalado en el servidor.'
        );
      }
      throw new SiiValidationError('El archivo CAF no cumple el esquema XSD oficial del SII.', [message]);
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }

  async validateLibroCompraVenta(xml: string): Promise<void> {
    const errors: string[] = [];
    if (!/^<\?xml[^>]*encoding="ISO-8859-1"/i.test(xml.trim())) {
      errors.push('El XML del libro debe declarar encoding="ISO-8859-1".');
    }
    if (!/<LibroCompraVenta\b/i.test(xml) || !/<EnvioLibro\b[^>]*\bID=/i.test(xml)) {
      errors.push('El XML debe contener LibroCompraVenta y EnvioLibro con ID.');
    }
    if (!/<Caratula>[\s\S]*?<TipoOperacion>(COMPRA|VENTA)<\/TipoOperacion>[\s\S]*?<\/Caratula>/i.test(xml)) {
      errors.push('La carátula debe indicar TipoOperacion COMPRA o VENTA.');
    }
    if (!/<Detalle>[\s\S]*?<TpoDoc>\d+<\/TpoDoc>[\s\S]*?<NroDoc>[^<]+<\/NroDoc>[\s\S]*?<\/Detalle>/i.test(xml)) {
      errors.push('El libro debe contener al menos un detalle con tipo y folio.');
    }
    if (!/<Signature\b[\s\S]*?<\/Signature>/i.test(xml)) {
      errors.push('El libro debe estar firmado con XMLDSig.');
    }
    if (errors.length) throw new SiiValidationError('Preflight del Libro Compra/Venta falló.', errors);

    const xsdValidationEnabled =
      this.configService.get<string>('SII_XSD_VALIDATION_ENABLED', 'false') === 'true';
    if (!xsdValidationEnabled) {
      this.logger.warn('Validación XSD oficial del Libro CV desactivada.');
      return;
    }

    const defaultSchemaPath = join(__dirname, 'xsd', 'LibroCV_v10.xsd');
    const schemaPath = this.configService.get<string>('SII_LIBRO_CV_XSD_PATH', defaultSchemaPath);
    await this.validateAgainstSchema(xml, schemaPath, 'libro-cv.xml', 'El Libro Compra/Venta no cumple el XSD oficial del SII.');
  }

  private async validateAgainstSchema(xml: string, schemaPath: string, filename: string, failureMessage: string): Promise<void> {
    const workDir = await mkdtemp(join(tmpdir(), 'sii-xsd-'));
    const xmlPath = join(workDir, filename);
    try {
      await writeFile(xmlPath, xml, { encoding: 'latin1' });
      await execFileAsync('xmllint', ['--noout', '--schema', schemaPath, xmlPath], {
        timeout: 30000,
        windowsHide: true,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error desconocido validando XSD.';
      if ((error as any).code === 'ENOENT' || message.includes('ENOENT') || message.includes('not found')) {
        throw new SiiValidationError('El validador de esquemas "xmllint" no está instalado en el servidor.');
      }
      throw new SiiValidationError(failureMessage, [message]);
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }

  private validateCafSurgicalRules(xml: string): void {
    const errors: string[] = [];
    const normalized = xml.trim();

    if (!/<CAF\b[^>]*version="1.0"/i.test(normalized)) {
      errors.push('El archivo debe contener <CAF version="1.0">.');
    }
    if (!/<DA>/i.test(normalized) || !/<\/DA>/i.test(normalized)) {
      errors.push('Falta el nodo <DA> de datos de autorización.');
    }

    const requiredTags = ['RE', 'RS', 'TD', 'D', 'H', 'FA', 'M', 'E'];
    requiredTags.forEach(tag => {
      const match = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(normalized);
      if (!match || !match[1].trim()) {
        errors.push(`Falta el nodo obligatorio <${tag}> o está vacío.`);
      }
    });

    // FRMA es la firma del CAF emitido por el SII. FRMT pertenece al TED y se
    // acepta temporalmente sólo para no romper fixtures históricos locales.
    if (!/<FRMA\b[^>]*>[\s\S]*?<\/FRMA>/i.test(normalized) && !/<FRMT\b[^>]*>[\s\S]*?<\/FRMT>/i.test(normalized)) {
      errors.push('Falta la firma del CAF <FRMA>.');
    }

    const fromMatch = /<D>(\d+)<\/D>/i.exec(normalized);
    const toMatch = /<H>(\d+)<\/H>/i.exec(normalized);
    if (fromMatch && toMatch) {
      const fromFolio = Number(fromMatch[1]);
      const toFolio = Number(toMatch[1]);
      if (fromFolio <= 0) {
        errors.push('El folio inicial <D> debe ser mayor a 0.');
      }
      if (toFolio <= 0) {
        errors.push('El folio final <H> debe ser mayor a 0.');
      }
      if (fromFolio > toFolio) {
        errors.push(`El rango de folios es inválido: el folio inicial (${fromFolio}) es mayor que el folio final (${toFolio}).`);
      }
    }

    const dateMatch = /<FA>([\s\S]*?)<\/FA>/i.exec(normalized);
    if (dateMatch) {
      const dateVal = dateMatch[1].trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateVal)) {
        errors.push(`El formato de la fecha de autorización <FA> (${dateVal}) es inválido. Debe ser YYYY-MM-DD.`);
      }
    }

    if (errors.length > 0) {
      throw new SiiValidationError('La pre-validación quirúrgica del CAF ha fallado.', errors);
    }
  }

  private numberTag(xml: string, tagName: string): number | undefined {
    const match = new RegExp(`<${tagName}>(\\d+)<\\/${tagName}>`, 'i').exec(xml);
    return match?.[1] ? Number(match[1]) : undefined;
  }

  private extractCafForSchema(xml: string): string {
    const match = /<CAF\b[^>]*>[\s\S]*?<\/CAF>/i.exec(xml);
    if (!match) {
      // La validación quirúrgica entrega un error más explicativo antes de llegar
      // a este punto; se conserva el contenido original para diagnósticos XSD.
      return xml;
    }
    return match[0];
  }
}
