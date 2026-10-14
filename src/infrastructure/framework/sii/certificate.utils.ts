import {
  X509Certificate,
  createPrivateKey,
  createPublicKey,
  randomBytes,
} from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

/** OpenSSL parses PKCS12; signing and verification use Node crypto/xml-crypto.
 * Passwords are passed via child environment, never argv or a shell. */
export class CertificateUtils {
  private static openssl(
    args: string[],
    password: string,
    input?: Buffer,
  ): Buffer {
    const gitOpenSsl = "C:/Program Files/Git/usr/bin/openssl.exe";
    const executable =
      process.env.OPENSSL_BIN ||
      (process.platform === "win32" && existsSync(gitOpenSsl)
        ? gitOpenSsl
        : "openssl");
    try {
      return execFileSync(executable, args, {
        input,
        env: { ...process.env, CMOR_PFX_PASSWORD: password },
        windowsHide: true,
        timeout: 30000,
        maxBuffer: 8 * 1024 * 1024,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch {
      // Never expose child output or key material in errors/logs.
      throw new Error(
        "OpenSSL no pudo procesar el certificado. Verifica instalación, formato y contraseña.",
      );
    }
  }

  public static extractKeyPair(
    pfxBase64: string,
    password: string,
  ): { privateKeyPem: string; certificatePem: string } {
    if (!password?.trim())
      throw new Error("La contraseña del certificado PFX es obligatoria.");
    if (
      !/^[A-Za-z0-9+/=\s]+$/.test(pfxBase64) ||
      pfxBase64.length > 8 * 1024 * 1024
    )
      throw new Error("PFX base64 inválido o demasiado grande.");
    const input = Buffer.from(pfxBase64, "base64");
    let pem: string;
    try {
      pem = this.openssl(
        ["pkcs12", "-nodes", "-passin", "env:CMOR_PFX_PASSWORD"],
        password,
        input,
      ).toString();
    } catch {
      // Older issuer bundles may use RC2/3DES; OpenSSL 3 legacy provider is
      // restricted to parsing the local bundle, not TLS or XML verification.
      pem = this.openssl(
        ["pkcs12", "-legacy", "-nodes", "-passin", "env:CMOR_PFX_PASSWORD"],
        password,
        input,
      ).toString();
    }
    const privateKeyPem = pem.match(
      /-----BEGIN (?:RSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA )?PRIVATE KEY-----/,
    )?.[0];
    if (!privateKeyPem) throw new Error("PFX sin llave privada.");
    const key = createPrivateKey(privateKeyPem);
    if (key.asymmetricKeyType !== "rsa")
      throw new Error("El certificado DTE debe usar RSA.");
    const publicDer = createPublicKey(key).export({
      type: "spki",
      format: "der",
    });
    const certificates =
      pem.match(
        /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g,
      ) || [];
    const certificatePem = certificates.find((candidate) =>
      new X509Certificate(candidate).publicKey
        .export({ type: "spki", format: "der" })
        .equals(publicDer),
    );
    if (!certificatePem)
      throw new Error(
        "PFX sin certificado correspondiente a la llave privada.",
      );
    return { privateKeyPem, certificatePem };
  }

  public static extractMetadata(
    pfxBase64: string,
    password: string,
  ): PfxMetadata {
    const { certificatePem } = this.extractKeyPair(pfxBase64, password);
    const cert = new X509Certificate(certificatePem);
    const cn = (dn: string) => /^CN=(.*)$/m.exec(dn)?.[1] || "Desconocido";
    const subjectName = cn(cert.subject);
    const serial = /^(?:serialNumber|dnQualifier)=(.*)$/im.exec(
      cert.subject,
    )?.[1];
    const representativeRut =
      serial?.replace(/[^0-9kK-]/g, "") ||
      /\b(\d{1,2}(?:\.?\d{3}){2}-?[0-9kK])\b/
        .exec(subjectName)?.[1]
        .replace(/\./g, "");
    return {
      subjectName,
      issuerName: cn(cert.issuer),
      validTo: new Date(cert.validTo).toISOString().slice(0, 10),
      fingerprint: cert.fingerprint.replace(/:/g, ""),
      representativeRut,
    };
  }

  public static generateMockChileanCertificate(
    rut: string,
    businessName: string,
    repRut: string,
    repName: string,
    password?: string,
  ): GeneratedCertificate {
    const finalPassword = password || randomBytes(16).toString("hex");
    const dir = mkdtempSync(join(tmpdir(), "cmor-mock-pfx-"));
    try {
      // Escape DN delimiters; this is an argv value, never shell input.
      const escape = (value: string) => value.replace(/[\\/+=\r\n]/g, "_");
      const keyPath = join(dir, "key.pem"),
        certPath = join(dir, "cert.pem");
      this.openssl(
        [
          "req",
          "-x509",
          "-newkey",
          "rsa:2048",
          "-nodes",
          "-sha256",
          "-days",
          "365",
          "-keyout",
          keyPath,
          "-out",
          certPath,
          "-subj",
          `/C=CL/O=${escape(businessName)}/OU=Representacion Tributaria/CN=${escape(repName)} ${escape(repRut)}`,
        ],
        finalPassword,
      );
      const pfx = this.openssl(
        [
          "pkcs12",
          "-export",
          "-inkey",
          keyPath,
          "-in",
          certPath,
          "-passout",
          "env:CMOR_PFX_PASSWORD",
        ],
        finalPassword,
      );
      return {
        pfxBase64: pfx.toString("base64"),
        password: finalPassword,
        certificatePem: readFileSync(certPath, "utf8"),
        privateKeyPem: readFileSync(keyPath, "utf8"),
      };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}
