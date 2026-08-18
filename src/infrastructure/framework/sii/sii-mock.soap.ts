import { Injectable, Logger } from '@nestjs/common';
import * as forge from 'node-forge';

@Injectable()
export class SiiMockSoap {
  private readonly logger = new Logger(SiiMockSoap.name);
  private readonly libroTracks = new Map<string, 'ACEPTADO' | 'RECHAZADO' | 'REPARO' | 'PROCESANDO'>();

  public receiveLibro(signedLibroXml: string, token: string): { success: boolean; trackId?: string; errorMsg?: string } {
    if (!token?.startsWith('MOCK_SII_TOKEN_')) return { success: false, errorMsg: 'Token de sesión inválido.' };
    if (!/<LibroCompraVenta\b/i.test(signedLibroXml) || !/<EnvioLibro\b[^>]*\bID=/i.test(signedLibroXml) || !/<Signature\b[\s\S]*?<\/Signature>/i.test(signedLibroXml)) {
      return { success: false, errorMsg: 'Libro CV sin estructura o firma XMLDSig válida.' };
    }
    const trackId = `L${Math.floor(100000000 + Math.random() * 900000000)}`;
    const state: 'ACEPTADO' | 'RECHAZADO' | 'REPARO' | 'PROCESANDO' =
      signedLibroXml.includes('<SimularRechazo>true</SimularRechazo>') ? 'RECHAZADO' :
      signedLibroXml.includes('<SimularReparo>true</SimularReparo>') ? 'REPARO' : 'ACEPTADO';
    this.libroTracks.set(trackId, state);
    return { success: true, trackId };
  }

  public queryLibro(trackId: string, token: string): 'ACEPTADO' | 'RECHAZADO' | 'REPARO' | 'PROCESANDO' {
    if (!token?.startsWith('MOCK_SII_TOKEN_')) throw new Error('Token de sesión inválido.');
    return this.libroTracks.get(trackId) || 'PROCESANDO';
  }

  /**
   * Simula el servicio 'getSeed' (Obtener Semilla) del SII.
   * Retorna un XML con una semilla aleatoria de 12 dígitos.
   */
  public getSeed(): string {
    this.logger.log('[MOCK SII SOAP] Recibida llamada getSeed(). Generando semilla...');
    const seed = Math.floor(100000000000 + Math.random() * 900000000000).toString();
    
    return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <getSeedResponse xmlns="http://www.sii.cl/XMLSchema">
      <semilla>${seed}</semilla>
    </getSeedResponse>
  </soapenv:Body>
</soapenv:Envelope>`;
  }

  /**
   * Simula el servicio 'getToken' (Obtener Token de Sesión) del SII.
   * Valida la firma digital de la semilla provista.
   */
  public getToken(signedSeedXml: string): { xmlResponse: string; token?: string } {
    this.logger.log('[MOCK SII SOAP] Recibida llamada getToken(). Validando firma de semilla...');

    try {
      const isSignatureValid = this.verifyXmlSignature(signedSeedXml, 'Semilla');
      
      if (!isSignatureValid) {
        this.logger.warn('[MOCK SII SOAP] Firma de semilla INVALIDA o corrupta.');
        return {
          xmlResponse: `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <soapenv:Fault>
      <faultcode>soapenv:Client</faultcode>
      <faultstring>Firma digital inválida en el nodo Semilla.</faultstring>
    </soapenv:Fault>
  </soapenv:Body>
</soapenv:Envelope>`
        };
      }

      // Generar token de sesión
      const token = 'MOCK_SII_TOKEN_' + forge.util.bytesToHex(forge.random.getBytesSync(16)).toUpperCase();
      this.logger.log(`[MOCK SII SOAP] Firma de semilla VALIDADA con éxito. Token emitido: ${token}`);

      const xmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <getTokenResponse xmlns="http://www.sii.cl/XMLSchema">
      <token>${token}</token>
    </getTokenResponse>
  </soapenv:Body>
</soapenv:Envelope>`;

      return { xmlResponse, token };
    } catch (error) {
      this.logger.error('[MOCK SII SOAP] Fallo al procesar getToken():', error);
      return {
        xmlResponse: `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <soapenv:Fault>
      <faultcode>soapenv:Server</faultcode>
      <faultstring>Internal Server Error: ${error.message}</faultstring>
    </soapenv:Fault>
  </soapenv:Body>
</soapenv:Envelope>`
      };
    }
  }

  /**
   * Simula la recepción de sobres DTE ('sendDte') del SII.
   * Valida:
   * 1. Autenticidad del Token de Sesión.
   * 2. Estructura del sobre XML.
   * 3. Firma criptográfica (XMLDSig) del DTE interno.
   */
  public receiveDte(signedDteXml: string, token: string): { success: boolean; trackId?: string; errorMsg?: string } {
    this.logger.log(`[MOCK SII SOAP] Recibido sobre DTE para validación de recepción con Token: ${token}`);

    if (!token || !token.startsWith('MOCK_SII_TOKEN_')) {
      this.logger.warn('[MOCK SII SOAP] Acceso denegado: Token de sesión inválido.');
      return { success: false, errorMsg: 'Token de sesión expirado o no autorizado.' };
    }

    try {
      // Validar la firma digital del DTE interno
      const isSignatureValid = this.verifyXmlSignature(signedDteXml, 'DocumentoDTE');
      
      if (!isSignatureValid) {
        this.logger.warn('[MOCK SII SOAP] Firma digital del DTE es INVÁLIDA.');
        return { success: false, errorMsg: 'La firma del DTE es inválida. Rechazado por el validador del SII.' };
      }

      // Generar Track ID oficial
      const trackId = Math.floor(1000000000 + Math.random() * 9000000000).toString();
      this.logger.log(`[MOCK SII SOAP] Firma del DTE VALIDADA. Documento ACEPTADO. TrackID: ${trackId}`);
      
      return {
        success: true,
        trackId
      };
    } catch (error) {
      this.logger.error('[MOCK SII SOAP] Fallo al procesar el DTE enviado:', error);
      return { success: false, errorMsg: `Error interno de procesamiento XML: ${error.message}` };
    }
  }

  /**
   * Validador criptográfico genérico para firmas XMLDSig.
   * Extrae la clave pública RSA (Modulus/Exponent) del XML, canonicaliza el bloque
   * <SignedInfo> y valida la firma (<SignatureValue>) usando node-forge.
   */
  private verifyXmlSignature(xml: string, targetId: string): boolean {
    try {
      // 1. Extraer Modulus y Exponent
      const modulusMatch = /<Modulus>([^<]+)<\/Modulus>/.exec(xml);
      const exponentMatch = /<Exponent>([^<]+)<\/Exponent>/.exec(xml);
      const signatureValueMatch = /<SignatureValue>([^<]+)<\/SignatureValue>/.exec(xml);

      if (!modulusMatch || !exponentMatch || !signatureValueMatch) {
        this.logger.error('[MOCK CRYPTO] Error de firma: No se encontraron los elementos RSA del bloque KeyInfo.');
        return false;
      }

      const modulusB64 = modulusMatch[1].trim();
      const exponentB64 = exponentMatch[1].trim();
      const signatureValueB64 = signatureValueMatch[1].trim();

      // 2. Extraer el bloque <SignedInfo>
      const signedInfoMatch = /(<SignedInfo>[\s\S]*?<\/SignedInfo>)/.exec(xml);
      if (!signedInfoMatch) {
        this.logger.error('[MOCK CRYPTO] Error de firma: No se encontró el bloque <SignedInfo>.');
        return false;
      }
      const rawSignedInfo = signedInfoMatch[1];
      const canonicalSignedInfo = this.canonicalizeXml(rawSignedInfo);

      // 3. Reconstruir la Clave Pública RSA en node-forge
      const modulusBytes = forge.util.decode64(modulusB64);
      const exponentBytes = forge.util.decode64(exponentB64);
      
      const modulusHex = forge.util.bytesToHex(modulusBytes);
      const exponentHex = forge.util.bytesToHex(exponentBytes);

      const modulusBigInt = new forge.jsbn.BigInteger(modulusHex, 16);
      const exponentBigInt = new forge.jsbn.BigInteger(exponentHex, 16);

      const publicKey = forge.pki.setRsaPublicKey(modulusBigInt, exponentBigInt);

      // 4. Decodificar firma y verificar contra el hash SHA-1 de <SignedInfo>
      const signatureBytes = forge.util.decode64(signatureValueB64);
      const md = forge.md.sha1.create();
      md.update(canonicalSignedInfo, 'utf8');

      const verified = publicKey.verify(md.digest().getBytes(), signatureBytes);
      this.logger.log(`[MOCK CRYPTO] Verificación criptográfica XMLDSig para ID "${targetId}": ${verified ? 'VÁLIDA' : 'INVÁLIDA'}`);
      
      return verified;
    } catch (e) {
      this.logger.error('[MOCK CRYPTO] Excepción en verificación criptográfica:', e);
      return false;
    }
  }

  /**
   * Canonicalización idéntica a la utilizada en el SignatureEngine
   */
  private canonicalizeXml(xml: string): string {
    return xml
      .replace(/[\r\n]/g, '')
      .replace(/>\s+</g, '><')
      .replace(/\s+/g, ' ')
      .replace(/\s*\/>/g, '/>')
      .replace(/='([^']*)'/g, '="$1"')
      .trim();
  }
}
