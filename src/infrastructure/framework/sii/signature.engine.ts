import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import * as forge from 'node-forge';
import { SignedXml } from 'xml-crypto';

@Injectable()
export class SignatureEngine {
  private readonly logger = new Logger(SignatureEngine.name);

  /**
   * Firma digitalmente un XML de DTE utilizando el estándar XMLDSig chileno.
   * Realiza la canonicalización C14N, firma RSA-SHA1 y adjunta los metadatos X.509 públicos.
   *
   * @param xmlContent XML original del DTE.
   * @param certificateBase64 Archivo PFX/P12 en formato Base64.
   * @param password Contraseña del archivo PFX/P12.
   * @param targetElementId ID del elemento a firmar (usualmente 'DocumentoDTE').
   */
  public signXml(
    xmlContent: string,
    certificateBase64: string,
    password: string,
    targetElementId = 'DocumentoDTE'
  ): { signedXml: string; signatureValue: string } {
    if (!password || password.trim() === '') {
      throw new BadRequestException('La contraseña del certificado PFX es obligatoria para firmar el DTE.');
    }
    this.logger.log('Iniciando firmado digital criptográfico REAL de DTE XML (XMLDSig)...');

    try {
      // 1. Extraer la llave privada y certificado del PFX/P12
      const p12Der = forge.util.decode64(certificateBase64);
      const p12Asn1 = forge.asn1.fromDer(p12Der);
      const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, password);

      // Obtener llave privada
      const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
      const privateKeyBag = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0];
      if (!privateKeyBag || !privateKeyBag.key) {
        throw new Error('No se encontró una llave privada válida en el archivo P12/PFX.');
      }
      const privateKey = privateKeyBag.key as forge.pki.rsa.PrivateKey;

      // Obtener certificado X.509 público
      const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
      const certBag = certBags[forge.pki.oids.certBag]?.[0];
      if (!certBag || !certBag.cert) {
        throw new Error('No se encontró un certificado X.509 válido en el archivo P12/PFX.');
      }
      const cert = certBag.cert;
      const certPem = forge.pki.certificateToPem(cert);
      
      // Limpiar PEM del certificado para tener la cadena pura en Base64
      const certCleanBase64 = certPem
        .replace(/-----BEGIN CERTIFICATE-----/, '')
        .replace(/-----END CERTIFICATE-----/, '')
        .replace(/[\r\n]/g, '');

      // xml-crypto hace C14N y el transform enveloped sobre un DOM. No se
      // puede sustituir por regex: cambia el digest ante namespaces, atributos
      // reordenados o texto escapado y puede insertar la firma fuera de la raíz.
      const targetId = targetElementId.replace(/'/g, "&apos;");
      if (!new RegExp(`\\bID=["']${targetElementId}["']`).test(xmlContent)) {
        throw new Error(`No se encontró un nodo con ID="${targetElementId}" en el XML suministrado.`);
      }
      const signer = new SignedXml({
        privateKey: forge.pki.privateKeyToPem(privateKey),
        publicCert: certPem,
        signatureAlgorithm: 'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
        canonicalizationAlgorithm: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
      });
      signer.addReference({
        xpath: `//*[@ID='${targetId}']`,
        transforms: [
          'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
          'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
        ],
        digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1',
      });
      signer.computeSignature(xmlContent, {
        // EnvioDTE firma SetDTE, pero su XSD exige <Signature> como hermano
        // de SetDTE bajo la raíz. Los demás documentos usan firma enveloped.
        location: targetElementId === 'SetDoc'
          ? { reference: "/*[local-name(.)='EnvioDTE' or local-name(.)='EnvioBOLETA']", action: 'append' }
          : { reference: `//*[@ID='${targetId}']`, action: 'append' },
      });
      const signedXml = signer.getSignedXml();
      const signatureValue = /<SignatureValue>([^<]+)<\/SignatureValue>/.exec(signer.getSignatureXml())?.[1];
      if (!signatureValue) throw new Error('No se pudo obtener SignatureValue del XMLDSig generado.');

      this.logger.log('Firmado digital XMLDSig completado de forma exitosa.');
      return {
        signedXml,
        signatureValue,
      };
    } catch (error) {
      this.logger.error('Error durante el firmado digital criptográfico del XML:', error);
      throw error;
    }
  }

}
