// backend/src/application/integrations/integration-credentials.use-case.ts
import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import { IDataServices, AuditLogEntity } from '@domain';
import { IntegrationSignatureUtil } from '../../infrastructure/framework/integrations/integration-signature.util';
import {
  INTEGRATION_PERMISSIONS,
  IntegrationPermissionValue,
} from './integration-errors';
import { IntegrationApiException } from './integration-api.exception';
import { IntegrationErrorCode } from './integration-errors';

/** Gracia por defecto de una rotación: la credencial antigua sigue válida 24h. */
const ROTATION_GRACE_MS = 24 * 60 * 60 * 1000;

export interface CreateCredentialInput {
  name: string;
  /** Tipo: 'api' para integradores (cmor_live_*), 'admin' para gestión (cmor_admin_*). */
  credentialType?: 'api' | 'admin';
  permissions: IntegrationPermissionValue[];
  expiresInDays?: number;
}

/** Permisos exclusivos de credenciales admin. */
const ADMIN_ONLY_PERMISSIONS = new Set([
  'credentials:read',
  'credentials:write',
  'webhooks:write',
]);

export interface CreateCredentialResult {
  credential: {
    id: string;
    keyId: string;
    name: string;
    credentialType: 'api' | 'admin';
    permissions: string[];
    status: string;
    expiresAt: Date | null;
    createdAt: Date;
  };
  /** Secreto en claro — se muestra UNA sola vez. */
  secret: string;
}

/**
 * Ciclo de vida de credenciales B2B: crear (secreto mostrado una sola vez),
 * listar enmascarado, rotar con gracia y revocar. El secreto jamás se
 * persiste: sólo su hash SHA-256 (clave de firma del HMAC).
 */
@Injectable()
export class IntegrationCredentialsUseCase {
  private readonly logger = new Logger(IntegrationCredentialsUseCase.name);

  constructor(private readonly dataServices: IDataServices) {}

  async create(tenantId: string, input: CreateCredentialInput): Promise<CreateCredentialResult> {
    if (!input.name?.trim()) {
      throw new BadRequestException('El nombre de la credencial es obligatorio.');
    }
    const credentialType = input.credentialType ?? 'api';
    const invalidPerms = (input.permissions || []).filter(
      (p) => !INTEGRATION_PERMISSIONS.includes(p),
    );
    if (invalidPerms.length > 0) {
      throw new BadRequestException(`Permisos inválidos: ${invalidPerms.join(', ')}.`);
    }
    if (input.permissions.length === 0) {
      throw new BadRequestException('La credencial requiere al menos un permiso.');
    }
    // Una credencial de API no puede tener permisos administrativos.
    if (credentialType === 'api') {
      const adminPerms = input.permissions.filter((p) => ADMIN_ONLY_PERMISSIONS.has(p));
      if (adminPerms.length > 0) {
        throw new BadRequestException(
          `Una credencial de API (cmor_live_*) no puede tener permisos administrativos: ${adminPerms.join(', ')}. Use una credencial admin (cmor_admin_*).`,
        );
      }
    }

    const keyId = IntegrationSignatureUtil.generateKeyId(credentialType);
    const secret = IntegrationSignatureUtil.generateSecret();
    const secretHash = IntegrationSignatureUtil.hashSecret(secret);
    const expiresAt = input.expiresInDays
      ? new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000)
      : null;

    const created = await firstValueFrom(
      this.dataServices.integrationCredential.create({
        tenantId,
        keyId,
        secretHash,
        secretLast4: secret.slice(-4),
        name: input.name.trim(),
        credentialType,
        permissions: [...input.permissions],
        status: 'active',
        expiresAt,
      } as any),
    );

    await this.audit(tenantId, 'INTEGRATION_CREDENTIAL_CREATED', {
      credentialId: created.id,
      keyId,
      credentialType,
      permissions: input.permissions,
      expiresAt,
    });

    this.logger.log(`Credencial B2B ${keyId} (${credentialType}) creada para tenant ${tenantId}`);
    return {
      credential: {
        id: created.id!,
        keyId,
        name: created.name,
        credentialType,
        permissions: created.permissions,
        status: created.status,
        expiresAt: created.expiresAt ?? null,
        createdAt: created.createdAt!,
      },
      secret,
    };
  }

  async list(tenantId: string) {
    const credentials = await firstValueFrom(
      this.dataServices.integrationCredential.find({ where: { tenantId } }),
    );
    return credentials
      .sort((a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime())
      .map((c) => ({
        id: c.id,
        keyId: c.keyId,
        name: c.name,
        credentialType: (c as any).credentialType ?? 'api',
        permissions: c.permissions,
        status: c.status,
        secretLast4: `****${c.secretLast4}`,
        expiresAt: c.expiresAt ?? null,
        lastUsedAt: c.lastUsedAt ?? null,
        rotatedFromId: c.rotatedFromId ?? null,
        createdAt: c.createdAt,
      }));
  }

  /**
   * Rotación: crea una credencial nueva y deja la antigua válida sólo hasta
   * el fin de la gracia (24h) o su expiración previa, la que ocurra antes.
   */
  async rotate(tenantId: string, credentialId: string): Promise<CreateCredentialResult> {
    const old = await firstValueFrom(
      this.dataServices.integrationCredential.get(credentialId),
    );
    if (!old || old.tenantId !== tenantId) {
      throw new NotFoundException('Credencial no encontrada.');
    }

    const graceExpiry = new Date(Date.now() + ROTATION_GRACE_MS);
    const effectiveExpiry =
      old.expiresAt && new Date(old.expiresAt) < graceExpiry
        ? new Date(old.expiresAt)
        : graceExpiry;

    const result = await this.create(tenantId, {
      name: `${old.name} (rotada)`,
      credentialType: (old as any).credentialType ?? 'api',
      permissions: old.permissions as IntegrationPermissionValue[],
    });

    await firstValueFrom(
      this.dataServices.integrationCredential.update(credentialId, {
        expiresAt: effectiveExpiry,
        revokedAt: effectiveExpiry,
      } as any),
    );

    await this.audit(tenantId, 'INTEGRATION_CREDENTIAL_ROTATED', {
      oldCredentialId: credentialId,
      oldKeyId: old.keyId,
      newCredentialId: result.credential.id,
      newKeyId: result.credential.keyId,
      graceUntil: effectiveExpiry,
    });

    return result;
  }

  async revoke(
    tenantId: string,
    credentialId: string,
    options: { actorCredentialId?: string } = {},
  ): Promise<{ revoked: true }> {
    const credential = await firstValueFrom(
      this.dataServices.integrationCredential.get(credentialId),
    );
    if (!credential || credential.tenantId !== tenantId) {
      throw new NotFoundException('Credencial no encontrada.');
    }

    // Anti-lockout: no permitir revocar la última credencial admin activa del tenant.
    if (credential.credentialType === 'admin' && credential.status === 'active') {
      const allCreds = await firstValueFrom(
        this.dataServices.integrationCredential.find({ where: { tenantId } }),
      );
      const activeAdmins = allCreds.filter(
        (c: any) => c.credentialType === 'admin' && c.status === 'active',
      );
      if (activeAdmins.length <= 1) {
        throw new IntegrationApiException(
          IntegrationErrorCode.SELF_REVOKE_LAST_ADMIN,
          'No se puede revocar la última credencial administrativa activa del tenant. Cree otra credencial admin primero.',
          422,
        );
      }
      if (options.actorCredentialId && credentialId === options.actorCredentialId) {
        throw new IntegrationApiException(
          IntegrationErrorCode.SELF_REVOKE_LAST_ADMIN,
          'Una credencial no puede revocarse a sí misma.',
          422,
        );
      }
    }

    await firstValueFrom(
      this.dataServices.integrationCredential.update(credentialId, {
        status: 'revoked',
        revokedAt: new Date(),
      } as any),
    );
    await this.audit(tenantId, 'INTEGRATION_CREDENTIAL_REVOKED', {
      credentialId,
      keyId: credential.keyId,
    });
    this.logger.log(`Credencial B2B ${credential.keyId} revocada`);
    return { revoked: true };
  }

  /** Auditoría sin secretos: sólo keyId y metadatos. */
  private async audit(tenantId: string, action: string, payload: any): Promise<void> {
    const log = new AuditLogEntity();
    log.tenantId = tenantId;
    log.action = action;
    log.payload = payload;
    await firstValueFrom(this.dataServices.auditLog.create(log)).catch((err) =>
      this.logger.warn(`No se pudo registrar auditoría ${action}: ${err.message}`),
    );
  }
}
