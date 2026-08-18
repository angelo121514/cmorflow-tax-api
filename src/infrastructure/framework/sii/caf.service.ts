import { Injectable } from '@nestjs/common';
import * as forge from 'node-forge';

export interface CafData {
  issuerRut: string;
  type: number;
  rangeFrom: number;
  rangeTo: number;
  authorizationDate: string;
  /** Bloque <CAF> exacto que debe incorporarse dentro del TED. Nunca contiene RSASK. */
  rawXml: string;
  /** Firma del SII sobre el CAF. El formato oficial usa <FRMA>. */
  frmaSignature?: string;
  /** Material sensible cifrado por TenantConfigService antes de persistir. */
  privateKeyEncrypted?: EncryptedCafPrivateKey;
  lastUsedFolio?: number;
}

export interface EncryptedCafPrivateKey {
  iv: string;
  ciphertext: string;
  authTag: string;
  salt?: string;
}

/** Resultado transitorio de parsear un archivo de autorización antes de persistirlo. */
export interface ParsedCafData extends CafData {
  privateKeyPem?: string;
}

@Injectable()
export class CafService {
  parse(cafXml: string): ParsedCafData {
    const normalized = cafXml.trim();
    const cafBlock = this.extractCaf(normalized);
    
    // Ejecutar validaciones quirúrgicas rápidas sincrónicas
    this.validateSurgicalRules(cafBlock);

    return {
      issuerRut: this.requiredTag(cafBlock, 'RE'),
      type: Number(this.requiredTag(cafBlock, 'TD')),
      rangeFrom: Number(this.requiredTag(cafBlock, 'D')),
      rangeTo: Number(this.requiredTag(cafBlock, 'H')),
      authorizationDate: this.requiredTag(cafBlock, 'FA'),
      rawXml: cafBlock,
      frmaSignature: this.optionalTag(cafBlock, 'FRMA') ?? this.optionalTag(cafBlock, 'FRMT'),
      privateKeyPem: this.extractPrivateKeyPem(normalized) ?? undefined,
    };
  }

  private validateSurgicalRules(xml: string): void {
    if (!/<CAF\b[^>]*version="1.0"/i.test(xml)) {
      throw new Error('El archivo no es un CAF válido (nodo raíz <CAF version="1.0"> requerido).');
    }
    if (!/<DA>/i.test(xml) || !/<\/DA>/i.test(xml)) {
      throw new Error('El CAF no contiene el nodo de datos de autorización <DA>.');
    }

    // Validar existencia de tags indispensables
    const requiredTags = ['RE', 'RS', 'TD', 'D', 'H', 'FA', 'M', 'E'];
    requiredTags.forEach(tag => {
      const match = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(xml);
      if (!match || !match[1].trim()) {
        throw new Error(`El CAF no contiene el nodo obligatorio <${tag}> o está vacío.`);
      }
    });

    // El CAF oficial usa FRMA. FRMT se acepta sólo para mantener los fixtures
    // de simulación antiguos mientras se migran.
    if (!this.optionalTag(xml, 'FRMA') && !this.optionalTag(xml, 'FRMT')) {
      throw new Error('El CAF no contiene la firma del SII <FRMA>.');
    }

    // Validar rango lógico
    const fromMatch = /<D>(\d+)<\/D>/i.exec(xml);
    const toMatch = /<H>(\d+)<\/H>/i.exec(xml);
    if (fromMatch && toMatch) {
      const fromFolio = Number(fromMatch[1]);
      const toFolio = Number(toMatch[1]);
      if (fromFolio <= 0 || toFolio <= 0) {
        throw new Error('Los folios en el rango CAF deben ser mayores a 0.');
      }
      if (fromFolio > toFolio) {
        throw new Error(`El rango de folios es inválido: el folio inicial (${fromFolio}) es mayor que el folio final (${toFolio}).`);
      }
    }

    // Validar formato de fecha YYYY-MM-DD
    const dateMatch = /<FA>([\s\S]*?)<\/FA>/i.exec(xml);
    if (dateMatch) {
      const dateVal = dateMatch[1].trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateVal)) {
        throw new Error(`El formato de la fecha de autorización <FA> (${dateVal}) es inválido. Debe ser YYYY-MM-DD.`);
      }
    }
  }

  assertFolioAllowed(cafXml: string, type: number, folio: number): CafData {
    const caf = this.parse(cafXml);
    if (caf.type !== type) {
      throw new Error(`El CAF es para tipo ${caf.type}, no para DTE ${type}.`);
    }
    if (folio < caf.rangeFrom || folio > caf.rangeTo) {
      throw new Error(`El folio ${folio} está fuera del rango CAF ${caf.rangeFrom}-${caf.rangeTo}.`);
    }

    return caf;
  }

  createSimulationCaf(issuerRut: string, type: number, rangeFrom = 1, rangeTo = 1000): string {
    // RSA-2048 mínimo: NIST prohíbe RSA-1024 desde 2013, el SII exige mínimo 2048 bits.
    const RSA_KEY_SIZE = 2048;
    const keys = forge.pki.rsa.generateKeyPair(RSA_KEY_SIZE);
    const today = new Date().toISOString().slice(0, 10);
    const modulus = this.bigIntToBase64(keys.publicKey.n);
    const exponent = this.bigIntToBase64(keys.publicKey.e);
    const daXml =
      `<DA>` +
      `<RE>${issuerRut}</RE>` +
      `<RS>CAF DE SIMULACION</RS>` +
      `<TD>${type}</TD>` +
      `<RNG><D>${rangeFrom}</D><H>${rangeTo}</H></RNG>` +
      `<FA>${today}</FA>` +
      `<RSAPK><M>${modulus}</M><E>${exponent}</E></RSAPK>` +
      `</DA>`;

    const md = forge.md.sha1.create();
    md.update(daXml, 'utf8');
    const signature = forge.util.encode64(keys.privateKey.sign(md));

    // El SII entrega el CAF como <AUTORIZACION>: el bloque <CAF> se incorpora al
    // TED y la llave privada RSASK se usa exclusivamente para firmar ese TED.
    // Mantener la misma forma en simulación evita ocultar errores de integración.
    const privatePem = forge.pki.privateKeyToPem(keys.privateKey);
    const publicPem = forge.pki.publicKeyToPem(keys.publicKey);
    return `<AUTORIZACION><CAF version="1.0">${daXml}<FRMA algoritmo="SHA1withRSA">${signature}</FRMA></CAF><RSASK>${privatePem}</RSASK><RSAPUBK>${publicPem}</RSAPUBK></AUTORIZACION>`;
  }

  /**
   * Extrae la clave privada del CAF para firmar el TED del DTE.
   * - En CAFs oficiales, RSASK es PEM dentro de <AUTORIZACION>, fuera de <CAF>.
   * - En fixtures antiguos se acepta RSASK en base64 para compatibilidad local.
   * Retorna null si no se encuentra la clave en el CAF.
   */
  extractPrivateKey(cafXml: string): forge.pki.rsa.PrivateKey | null {
    const privateKeyPem = this.extractPrivateKeyPem(cafXml);
    if (!privateKeyPem) {
      return null;
    }
    return this.privateKeyFromPem(privateKeyPem);
  }

  extractPrivateKeyPem(cafXml: string): string | null {
    const rsaskMatch = /<RSASK\b[^>]*>([\s\S]*?)<\/RSASK>/i.exec(cafXml);
    if (!rsaskMatch || !rsaskMatch[1]?.trim()) {
      return null;
    }

    const value = this.decodeXmlEntities(rsaskMatch[1]).trim();
    if (/-----BEGIN(?: RSA)? PRIVATE KEY-----/.test(value)) {
      return value;
    }

    try {
      const privatePem = forge.util.decode64(value);
      return /-----BEGIN(?: RSA)? PRIVATE KEY-----/.test(privatePem) ? privatePem : null;
    } catch {
      return null;
    }
  }

  privateKeyFromPem(privateKeyPem: string): forge.pki.rsa.PrivateKey | null {
    try {
      return forge.pki.privateKeyFromPem(privateKeyPem);
    } catch {
      return null;
    }
  }

  extractCafXml(xml: string): string {
    return this.extractCaf(xml);
  }

  private extractCaf(xml: string): string {
    const match = /<CAF\b[^>]*>[\s\S]*?<\/CAF>/i.exec(xml);
    if (!match) {
      throw new Error('El archivo CAF no contiene un nodo <CAF>.');
    }
    return match[0];
  }

  private requiredTag(xml: string, tagName: string): string {
    const value = this.optionalTag(xml, tagName);
    if (!value) {
      throw new Error(`El CAF no contiene el nodo <${tagName}>.`);
    }
    return value;
  }

  private optionalTag(xml: string, tagName: string): string | undefined {
    const match = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i').exec(xml);
    return match?.[1]?.trim();
  }

  private decodeXmlEntities(value: string): string {
    return value
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'");
  }

  private bigIntToBase64(value: forge.jsbn.BigInteger): string {
    let hex = value.toString(16);
    if (hex.length % 2 !== 0) {
      hex = `0${hex}`;
    }
    return forge.util.encode64(forge.util.hexToBytes(hex));
  }
}
