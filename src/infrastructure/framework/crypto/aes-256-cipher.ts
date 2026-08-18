import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';

/**
 * Salt legacy usado antes de la generación aleatoria por encriptación.
 * Se conserva ÚNICAMENTE para poder desencriptar material persistido con el
 * esquema anterior. Todo material nuevo se encripta con un salt aleatorio que
 * se almacena junto al ciphertext/iv/authTag.
 */
const LEGACY_SALT = 'sii-certification-salt-key';

export interface EncryptedPayload {
  iv: string;
  ciphertext: string;
  authTag: string;
  /** Salt aleatorio (hex) usado en la derivación de clave. Ausente en material legacy. */
  salt?: string;
}

@Injectable()
export class Aes256Cipher {
  private readonly algorithm = 'aes-256-gcm';

  /**
   * Encripta un texto plano usando AES-256-GCM con un salt aleatorio por operación.
   * Retorna el texto cifrado en hexadecimal, el IV, el Auth Tag y el salt.
   */
  encrypt(text: string, masterKey: string): EncryptedPayload {
    const iv = crypto.randomBytes(12);
    // Salt aleatorio por operación: cada encriptación deriva una clave distinta
    const salt = crypto.randomBytes(16);
    const key = crypto.scryptSync(masterKey, salt, 32);
    const cipher = crypto.createCipheriv(this.algorithm, key, iv);

    let ciphertext = cipher.update(text, 'utf8', 'hex');
    ciphertext += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');

    return {
      iv: iv.toString('hex'),
      ciphertext,
      authTag,
      salt: salt.toString('hex'),
    };
  }

  /**
   * Desencripta un texto cifrado usando AES-256-GCM.
   * Si se provee `saltHex` (material nuevo), se usa ese salt. Si no (material
   * legacy persistido antes del fix), se usa el salt legacy para retrocompatibilidad.
   */
  decrypt(ciphertext: string, masterKey: string, ivHex: string, authTagHex: string, saltHex?: string): string {
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const salt = saltHex ? Buffer.from(saltHex, 'hex') : Buffer.from(LEGACY_SALT, 'utf8');
    const key = crypto.scryptSync(masterKey, salt, 32);

    const decipher = crypto.createDecipheriv(this.algorithm, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }
}
