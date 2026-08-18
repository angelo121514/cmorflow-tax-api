import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as forge from 'node-forge';
import { DteXmlEngine } from './dte-xml.engine';

@Injectable()
export class DteXmlBuilder implements OnModuleInit {
  private readonly logger = new Logger(DteXmlBuilder.name);

  private cafPrivateKey: forge.pki.rsa.PrivateKey;
  private cafPublicModulusB64: string;
  private cafPublicExponentB64: string;
  private cafFrmtSignature: string;

  constructor(private readonly dteXmlEngine: DteXmlEngine) {}

  /**
   * On module initialization, generate a real RSA key pair for the CAF simulation.
   * This avoids embedding invalid PEM keys and ensures all crypto operations work correctly.
   */
  onModuleInit() {
    // RSA-2048 mínimo: NIST prohíbe RSA-1024 desde 2013, el SII exige mínimo 2048 bits.
    const RSA_KEY_SIZE = 2048;
    this.logger.log(`Generando par de llaves RSA de ${RSA_KEY_SIZE}-bit para el CAF de simulación...`);
    const keys = forge.pki.rsa.generateKeyPair(RSA_KEY_SIZE);
    this.cafPrivateKey = keys.privateKey;

    // Extract modulus and exponent in Base64 for the <RSAPK> node
    let nHex = keys.publicKey.n.toString(16);
    if (nHex.length % 2 !== 0) nHex = '0' + nHex;
    this.cafPublicModulusB64 = forge.util.encode64(forge.util.hexToBytes(nHex));

    let eHex = keys.publicKey.e.toString(16);
    if (eHex.length % 2 !== 0) eHex = '0' + eHex;
    this.cafPublicExponentB64 = forge.util.encode64(forge.util.hexToBytes(eHex));

    // Pre-compute a mock FRMT signature for the CAF authorization block
    const md = forge.md.sha1.create();
    md.update('MOCK_CAF_AUTHORIZATION_DATA', 'utf8');
    this.cafFrmtSignature = forge.util.encode64(this.cafPrivateKey.sign(md));

    this.logger.log('Par de llaves RSA del CAF generado exitosamente.');
  }

  /**
   * Construye el XML DTE 33 estructurado estricto conforme a la reglamentación del SII.
   * Incluye el nodo de Timbre Electrónico DTE (TED) debidamente firmado por la clave del CAF.
   */
  public buildDte33Xml(
    tenantId: string,
    rutEmisor: string,
    businessName: string,
    folio: number,
    receiverRut: string,
    receiverName: string,
    amount: number,
    items: any[]
  ): { xml: string; tedXml: string } {
    this.logger.log(`Generando XML DTE 33 para Folio ${folio}...`);

    const built = this.dteXmlEngine.buildDte({
      type: 33,
      folio,
      issuer: {
        rut: rutEmisor,
        businessName,
        giro: 'SERVICIOS TECNOLOGICOS',
        acteco: '620100',
      },
      receiver: {
        rut: receiverRut,
        businessName: receiverName,
        giro: 'SERVICIOS CORPORATIVOS',
      },
      items: items.map((item) => ({
        name: item.name,
        quantity: item.quantity,
        price: item.price,
      })),
    });

    return { xml: built.xml, tedXml: built.tedXml };
  }

  /**
   * Realiza la firma RSA-SHA1 de la estructura <DD> (Datos del Documento)
   * utilizando la llave privada del CAF generada al inicio del módulo.
   */
  private signTedData(ddXml: string): string {
    const md = forge.md.sha1.create();
    md.update(ddXml, 'utf8');
    const signatureBytes = this.cafPrivateKey.sign(md);
    return forge.util.encode64(signatureBytes);
  }

  /**
   * Escapa caracteres reservados de XML.
   */
  private escapeXml(unsafe: string): string {
    return unsafe.replace(/[<>&'"]/g, (c) => {
      switch (c) {
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '&': return '&amp;';
        case '\'': return '&apos;';
        case '"': return '&quot;';
        default: return c;
      }
    });
  }
}
