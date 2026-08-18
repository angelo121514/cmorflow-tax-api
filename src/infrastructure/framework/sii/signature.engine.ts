import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import * as forge from 'node-forge';

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

      // 2. Localizar y canonicalizar el nodo objetivo por ID.
      const targetRegex = new RegExp(
        `<([A-Za-z_:][\\w:.-]*)\\b[^>]*\\bID="${targetElementId}"[^>]*>[\\s\\S]*?<\\/\\1>`,
        'g',
      );
      const match = targetRegex.exec(xmlContent);
      if (!match) {
        throw new Error(`No se encontró un nodo con ID="${targetElementId}" en el XML suministrado.`);
      }
      const targetTagName = match[1];
      const rawDocumentNode = match[0];
      const canonicalizedDoc = this.canonicalizeXml(rawDocumentNode);

      // 3. Calcular Digest (SHA-1) del nodo Documento
      const mdDoc = forge.md.sha1.create();
      mdDoc.update(canonicalizedDoc, 'utf8');
      const digestValue = forge.util.encode64(mdDoc.digest().getBytes());

      // 4. Construir bloque <SignedInfo> canonicalizado
      const signedInfoNode = 
        `<SignedInfo>` +
          `<CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/>` +
          `<SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"/>` +
          `<Reference URI="#${targetElementId}">` +
            `<Transforms>` +
              `<Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/>` +
            `</Transforms>` +
            `<DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"/>` +
            `<DigestValue>${digestValue}</DigestValue>` +
          `</Reference>` +
        `</SignedInfo>`;

      const canonicalizedSignedInfo = this.canonicalizeXml(signedInfoNode);

      // 5. Firmar el bloque <SignedInfo> usando la llave privada RSA
      const mdSign = forge.md.sha1.create();
      mdSign.update(canonicalizedSignedInfo, 'utf8');
      const signatureBytes = privateKey.sign(mdSign);
      const signatureValue = forge.util.encode64(signatureBytes);

      // 6. Obtener Modulus y Exponent de la clave pública para el RSAKeyValue
      const publicKey = cert.publicKey as forge.pki.rsa.PublicKey;
      
      let nHex = publicKey.n.toString(16);
      if (nHex.length % 2 !== 0) nHex = '0' + nHex;
      const modulus = forge.util.encode64(forge.util.hexToBytes(nHex));

      let eHex = publicKey.e.toString(16);
      if (eHex.length % 2 !== 0) eHex = '0' + eHex;
      const exponent = forge.util.encode64(forge.util.hexToBytes(eHex));

      // 7. Estructurar bloque <Signature> completo
      const signatureBlock = 
  `<Signature xmlns="http://www.w3.org/2000/09/xmldsig#">` +
    `<SignedInfo>` +
      `<CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/>` +
      `<SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"/>` +
      `<Reference URI="#${targetElementId}">` +
        `<Transforms>` +
          `<Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/>` +
        `</Transforms>` +
        `<DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"/>` +
        `<DigestValue>${digestValue}</DigestValue>` +
      `</Reference>` +
    `</SignedInfo>` +
    `<SignatureValue>${signatureValue}</SignatureValue>` +
    `<KeyInfo>` +
      `<KeyValue>` +
        `<RSAKeyValue>` +
          `<Modulus>${modulus}</Modulus>` +
          `<Exponent>${exponent}</Exponent>` +
        `</RSAKeyValue>` +
      `</KeyValue>` +
      `<X509Data>` +
        `<X509Certificate>${certCleanBase64}</X509Certificate>` +
      `</X509Data>` +
    `</KeyInfo>` +
  `</Signature>`;

      // 8. Insertar el bloque de firma como firma enveloped del nodo objetivo.
      const targetStart = match.index;
      const targetEnd = targetStart + rawDocumentNode.length;
      let signedTargetNode = rawDocumentNode;
      const closingTag = `</${targetTagName}>`;
      if (targetElementId === 'EnvioDTE') {
        const closingIndex = rawDocumentNode.lastIndexOf(closingTag);
        signedTargetNode =
          rawDocumentNode.slice(0, closingIndex) +
          '\n' +
          signatureBlock +
          '\n' +
          rawDocumentNode.slice(closingIndex);
      } else {
        signedTargetNode = rawDocumentNode + '\n' + signatureBlock;
      }
      const signedXml =
        xmlContent.slice(0, targetStart) +
        signedTargetNode +
        xmlContent.slice(targetEnd);

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

  /**
   * Implementa una canonicalización C14N simplificada pero robusta y simétrica,
   * garantizando que no existan espacios en blanco extraños en los tags y los atributos
   * estén perfectamente limpios para la firma criptográfica RSA.
   */
  private canonicalizeXml(xml: string): string {
    return xml
      // Eliminar retornos de carro y saltos de línea
      .replace(/[\r\n]/g, '')
      // Eliminar espacios en blanco inter-elementos (entre tags cerrados e iniciados)
      .replace(/>\s+</g, '><')
      // Eliminar espacios en blanco múltiples
      .replace(/\s+/g, ' ')
      // Asegurar que los tags autocerrados terminen sin espacios (ej. <Transform /> -> <Transform/>)
      .replace(/\s*\/>/g, '/>')
      // Reemplazar comillas simples de atributos por comillas dobles
      .replace(/='([^']*)'/g, '="$1"')
      .trim();
  }
}
