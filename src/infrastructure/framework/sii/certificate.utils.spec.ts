import { X509Certificate } from "node:crypto";
import { CertificateUtils } from "./certificate.utils";
import { SignatureEngine } from "./signature.engine";
import { DOMParser } from "@xmldom/xmldom";
import { SignedXml } from "xml-crypto";

describe("Native certificate boundary", () => {
  it("parses PKCS12, matches private key/certificate, preserves metadata and rejects wrong password", () => {
    const generated = CertificateUtils.generateMockChileanCertificate(
      "76123456-7",
      "Prueba SpA",
      "12345678-9",
      "Representante",
    );
    const metadata = CertificateUtils.extractMetadata(
      generated.pfxBase64,
      generated.password,
    );
    expect(metadata.subjectName).toContain("12345678-9");
    expect(metadata.representativeRut).toBe("12345678-9");
    expect(metadata.fingerprint).toBe(
      new X509Certificate(generated.certificatePem).fingerprint.replace(
        /:/g,
        "",
      ),
    );
    expect(() =>
      CertificateUtils.extractKeyPair(generated.pfxBase64, "incorrect"),
    ).toThrow("OpenSSL");
    const xml = '<Documento ID="DocumentoDTE"><Valor>1</Valor></Documento>';
    const signed = new SignatureEngine().signXml(
      xml,
      generated.pfxBase64,
      generated.password,
    ).signedXml;
    const tampered = signed.replace("<Valor>1</Valor>", "<Valor>2</Valor>");
    const verifier = new SignedXml({
      publicCert: generated.certificatePem,
      getCertFromKeyInfo: () => null,
    });
    const document = new DOMParser().parseFromString(tampered, "text/xml");
    verifier.loadSignature(
      document
        .getElementsByTagNameNS(
          "http://www.w3.org/2000/09/xmldsig#",
          "Signature",
        )
        .item(0)!
        .toString(),
    );
    expect(verifier.checkSignature(tampered)).toBe(false);
  });
});
