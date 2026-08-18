import * as forge from 'node-forge';

export interface GeneratedCertificate {
  pfxBase64: string;
  password: string;
  certificatePem: string;
  privateKeyPem: string;
}

export interface PfxMetadata {
  subjectName: string;
  validTo: string;
  issuerName: string;
  fingerprint: string;
  representativeRut?: string;
}

export class CertificateUtils {
  /**
   * Parsea un archivo PFX (PKCS12) en base64 y extrae metadatos reales.
   */
  public static extractMetadata(pfxBase64: string, password: string): PfxMetadata {
    if (!password || password.trim() === '') {
      throw new Error('La contraseña del certificado PFX es obligatoria para extraer metadatos.');
    }
    try {
      const p12Der = forge.util.decode64(pfxBase64);
      const p12Asn1 = forge.asn1.fromDer(p12Der);
      const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, password);

      // Obtener certificado X.509
      const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
      const certBag = certBags[forge.pki.oids.certBag]?.[0];
      if (!certBag || !certBag.cert) {
        throw new Error('No se encontró un certificado X.509 válido en el archivo P12/PFX.');
      }
      const cert = certBag.cert;

      // Calcular huella (fingerprint) SHA-1 de los bytes DER del certificado
      const certDer = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
      const md = forge.md.sha1.create();
      md.update(certDer);
      const fingerprint = md.digest().toHex().toUpperCase();

      // Obtener el Common Name (CN)
      const getCommonName = (attrs: any[]) => {
        const attr = attrs.find((a) => a.name === 'commonName' || a.type === forge.pki.oids.commonName);
        return attr ? String(attr.value) : 'Desconocido';
      };

      const subjectName = getCommonName(cert.subject.attributes);
      const issuerName = getCommonName(cert.issuer.attributes);
      
      // Fecha de expiración en formato YYYY-MM-DD
      const validToDate = cert.validity.notAfter;
      const validTo = validToDate.toISOString().split('T')[0];

      // Intentar extraer el RUT del representante desde el commonName o serialNumber del subject
      let representativeRut: string | undefined;
      const serialAttr = cert.subject.attributes.find(
        (a) => a.name === 'serialName' || a.name === 'serialNumber' || a.name === 'dnQualifier',
      );
      
      if (serialAttr && typeof serialAttr.value === 'string') {
        representativeRut = serialAttr.value.replace(/[^0-9kK-]/g, '');
      } else {
        // Buscar un patrón de RUT chileno en el subjectName (ej. "Nombre Apellido 12345678-9")
        const rutMatch = /\b(\d{1,2}(?:\.?\d{3}){2}-?[0-9kK])\b/.exec(subjectName);
        if (rutMatch) {
          representativeRut = rutMatch[1].replace(/\./g, ''); // Sin puntos
        }
      }

      return {
        subjectName,
        validTo,
        issuerName,
        fingerprint,
        representativeRut,
      };
    } catch (error) {
      throw new Error(`Error al parsear o extraer metadatos del PFX: ${error.message}`);
    }
  }
  /**
   * Genera un certificado digital de pruebas auto-firmado con la estructura X.509
   * exacta exigida para la representación tributaria ante el SII en Chile.
   */
  public static generateMockChileanCertificate(
    rut: string,
    businessName: string,
    repRut: string,
    repName: string,
    password?: string
  ): GeneratedCertificate {
    // Si no se provee password, generar uno aleatorio de 16 chars (no usar default hardcoded)
    const finalPassword = password || forge.util.bytesToHex(forge.random.getBytesSync(8));
    const pki = forge.pki;

    // 1. Generar par de llaves RSA de 2048 bits
    const keys = pki.rsa.generateKeyPair(2048);

    // 2. Crear certificado X.509
    const cert = pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = Math.floor(Math.random() * 1000000).toString();
    
    // Validez de 1 año
    cert.validity.notBefore = new Date();
    cert.validity.notAfter = new Date();
    cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);

    // Atributos del Subject conforme a los emitidos por Acepta/E-Sign en Chile
    const attrs = [
      { name: 'countryName', value: 'CL' },
      { name: 'organizationName', value: businessName },
      { name: 'organizationalUnitName', value: 'Representacion Tributaria' },
      { name: 'commonName', value: `${repName} ${repRut}` },
      { name: 'emailAddress', value: `${repName.toLowerCase().replace(/\s+/g, '.')}@${businessName.toLowerCase().replace(/[\s\.]+/g, '')}.cl` }
    ];

    cert.setSubject(attrs);
    cert.setIssuer(attrs); // Auto-firmado

    // 3. Extensiones X.509 estándar para firmas DTE chilenas (Firma Digital, No repudio, Cifrado de Claves)
    cert.setExtensions([
      {
        name: 'basicConstraints',
        cA: false
      },
      {
        name: 'keyUsage',
        digitalSignature: true,
        nonRepudiation: true,
        keyEncipherment: true,
        dataEncipherment: true
      },
      {
        name: 'extKeyUsage',
        serverAuth: false,
        clientAuth: true,
        codeSigning: false,
        emailProtection: true,
        timeStamping: false
      },
      {
        name: 'subjectKeyIdentifier'
      }
    ]);

    // 4. Firmar el certificado usando la llave privada
    cert.sign(keys.privateKey, forge.md.sha1.create());

    // 5. Empaquetar como archivo PKCS12 (PFX/P12) compatible con navegadores y librerías
    const p12Asn1 = forge.pkcs12.toPkcs12Asn1(
      keys.privateKey,
      [cert],
      finalPassword,
      { algorithm: '3des' }
    );

    const p12Der = forge.asn1.toDer(p12Asn1).getBytes();
    const pfxBase64 = forge.util.encode64(p12Der);

    const certificatePem = pki.certificateToPem(cert);
    const privateKeyPem = pki.privateKeyToPem(keys.privateKey);

    return {
      pfxBase64,
      password: finalPassword,
      certificatePem,
      privateKeyPem
    };
  }
}
