import { DOMParser } from '@xmldom/xmldom';
import { SignedXml } from 'xml-crypto';
import { SignatureEngine } from './signature.engine';
import { CertificateUtils } from './certificate.utils';

describe('SignatureEngine', () => {
  it('genera una única raíz y XMLDSig verificable para Documento y EnvioBOLETA', () => {
    const certificate = CertificateUtils.generateMockChileanCertificate('76123456-7', 'Prueba SpA', '12345678-9', 'Representante');
    const engine = new SignatureEngine();
    for (const [xml, id] of [
      ['<?xml version="1.0" encoding="ISO-8859-1"?><Documento ID="DocumentoDTE"><Valor>1</Valor></Documento>', 'DocumentoDTE'],
      ['<?xml version="1.0" encoding="ISO-8859-1"?><EnvioBOLETA><SetDTE ID="SetDoc"><Valor>1</Valor></SetDTE></EnvioBOLETA>', 'SetDoc'],
    ]) {
      const signed = engine.signXml(xml, certificate.pfxBase64, certificate.password, id).signedXml;
      const document = new DOMParser().parseFromString(signed, 'text/xml');
      expect(document.documentElement!.nodeName).toBe(id === 'DocumentoDTE' ? 'Documento' : 'EnvioBOLETA');
      const signature: any = document.getElementsByTagNameNS('http://www.w3.org/2000/09/xmldsig#', 'Signature').item(0)!;
      const verifier = new SignedXml({ publicCert: certificate.certificatePem, getCertFromKeyInfo: () => null });
      verifier.loadSignature(signature);
      expect(verifier.checkSignature(signed)).toBe(true);
    }
  });
});
