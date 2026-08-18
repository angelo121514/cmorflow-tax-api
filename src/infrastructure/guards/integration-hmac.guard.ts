import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ClsService } from 'nestjs-cls';
import { firstValueFrom } from 'rxjs';
import { randomBytes } from 'crypto';
import { IDataServices } from '@domain';
import { IntegrationApiException } from '../../application/integrations/integration-api.exception';
import { IntegrationErrorCode } from '../../application/integrations/integration-errors';
import { INTEGRATION_PERMISSIONS_KEY } from '../decorators/integration-permission.decorator';
import { IntegrationSignatureUtil } from '../framework/integrations/integration-signature.util';

/**
 * Guard HMAC de la API B2B /integrations.
 *
 * Encabezados exigidos:
 * - X-Api-Key: keyId público de la credencial (cmk_…).
 * - X-Timestamp: epoch en segundos (ventana ±300s por defecto).
 * - X-Nonce: valor único por credencial dentro de la ventana (antireplay).
 * - X-Signature: HMAC-SHA256 hex del string canónico
 *   METHOD\nruta?query\nsha256(body)\ntimestamp\nnonce, con clave
 *   sha256hex(secreto) — ver IntegrationSignatureUtil.
 *
 * El tenant se resuelve EXCLUSIVAMENTE desde la credencial (fail-closed):
 * un x-tenant-id del cliente que no coincida se rechaza con 403, y el
 * payload nunca se consulta para resolver tenancy.
 *
 * El rate limit se aplica DESPUÉS de verificar la firma para que un
 * atacante no pueda agotar la cuota de una credencial ajena.
 */
@Injectable()
export class IntegrationHmacGuard implements CanActivate {
  private readonly logger = new Logger(IntegrationHmacGuard.name);
  /** Ventana deslizante en memoria por credencial (instancia única en Render). */
  private readonly requestTimestamps = new Map<string, number[]>();

  constructor(
    private readonly reflector: Reflector,
    private readonly dataServices: IDataServices,
    private readonly cls: ClsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (process.env.INTEGRATIONS_API_ENABLED !== 'true') {
      throw new IntegrationApiException(
        IntegrationErrorCode.API_DISABLED,
        'La API de integraciones está deshabilitada en este ambiente.',
        HttpStatus.NOT_FOUND,
      );
    }

    const request = context.switchToHttp().getRequest();
    const keyId = request.headers['x-api-key'] as string | undefined;
    const timestamp = request.headers['x-timestamp'] as string | undefined;
    const nonce = request.headers['x-nonce'] as string | undefined;
    const signature = request.headers['x-signature'] as string | undefined;

    if (!keyId || !timestamp || !nonce || !signature) {
      throw new IntegrationApiException(
        IntegrationErrorCode.MISSING_HEADERS,
        'Se requieren los encabezados X-Api-Key, X-Timestamp, X-Nonce y X-Signature.',
        HttpStatus.UNAUTHORIZED,
      );
    }

    // 1. Resolver credencial (lookup global por keyId).
    const credential = await firstValueFrom(
      this.dataServices.integrationCredential.findOne({ where: { keyId } }),
    );
    if (!credential) {
      throw new IntegrationApiException(
        IntegrationErrorCode.UNKNOWN_KEY,
        'Credencial de integración desconocida.',
        HttpStatus.UNAUTHORIZED,
      );
    }
    if (credential.status === 'revoked') {
      throw new IntegrationApiException(
        IntegrationErrorCode.CREDENTIAL_REVOKED,
        'La credencial de integración está revocada.',
        HttpStatus.UNAUTHORIZED,
      );
    }
    if (credential.expiresAt && new Date(credential.expiresAt) <= new Date()) {
      throw new IntegrationApiException(
        IntegrationErrorCode.CREDENTIAL_EXPIRED,
        'La credencial de integración ha expirado.',
        HttpStatus.UNAUTHORIZED,
      );
    }

    // 2. Ventana antireplay del timestamp.
    const windowSeconds = Number(process.env.INTEGRATION_HMAC_WINDOW_SECONDS || 300);
    const nowSeconds = Math.floor(Date.now() / 1000);
    const ts = Number.parseInt(timestamp, 10);
    if (Number.isNaN(ts) || Math.abs(nowSeconds - ts) > windowSeconds) {
      throw new IntegrationApiException(
        IntegrationErrorCode.TIMESTAMP_OUT_OF_WINDOW,
        `X-Timestamp fuera de la ventana antireplay (±${windowSeconds}s).`,
        HttpStatus.UNAUTHORIZED,
      );
    }

    // 3. Verificar firma. La clave de firma es sha256hex(secreto), que es
    //    exactamente el secretHash persistido.
    const rawBody = request.rawBody ?? (request.body !== undefined ? JSON.stringify(request.body) : '');
    const bodyHash = IntegrationSignatureUtil.bodyHash(rawBody);
    const pathWithQuery = request.originalUrl || request.url;
    const canonical = IntegrationSignatureUtil.canonicalString(
      request.method,
      pathWithQuery,
      bodyHash,
      timestamp,
      nonce,
    );
    const expected = IntegrationSignatureUtil.sign(credential.secretHash, canonical);
    if (!IntegrationSignatureUtil.safeEquals(signature, expected)) {
      throw new IntegrationApiException(
        IntegrationErrorCode.INVALID_SIGNATURE,
        'Firma HMAC inválida.',
        HttpStatus.UNAUTHORIZED,
      );
    }

    // 4. Consumir nonce (antireplay). Un nonce ya registrado se rechaza
    //    siempre; los expirados los purga el reconciler.
    await this.consumeNonce(credential.id!, nonce, windowSeconds);

    // 5. Rate limit por credencial (después de autenticar).
    this.enforceRateLimit(credential.id!);

    // 6. Permisos de la credencial vs los exigidos por el endpoint.
    const required = this.reflector.getAllAndOverride<string[]>(
      INTEGRATION_PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (required && required.length > 0) {
      const granted = credential.permissions || [];
      const missing = required.filter((perm) => !granted.includes(perm));
      if (missing.length > 0) {
        throw new IntegrationApiException(
          IntegrationErrorCode.PERMISSION_DENIED,
          `La credencial no tiene los permisos requeridos: ${missing.join(', ')}.`,
          HttpStatus.FORBIDDEN,
        );
      }
    }

    // 7. Tenant fail-closed: la credencial manda; el header sólo puede coincidir.
    const headerTenant = request.headers['x-tenant-id'] as string | undefined;
    if (headerTenant && headerTenant !== credential.tenantId) {
      throw new IntegrationApiException(
        IntegrationErrorCode.TENANT_MISMATCH,
        'El tenant de la credencial no coincide con x-tenant-id. El tenant se resuelve exclusivamente desde la credencial.',
        HttpStatus.FORBIDDEN,
      );
    }
    request.headers['x-tenant-id'] = credential.tenantId;
    this.cls.set('tenantId', credential.tenantId);
    this.cls.set('credentialId', credential.id);
    request.integrationCredential = credential;

    // 8. Correlation ID: acepta X-Request-ID del cliente o genera uno nuevo
    //    (formato req_ + ULID-like). Se propaga a logs, auditoría y webhooks
    //    para trazabilidad punta a punta.
    const clientRequestId = request.headers['x-request-id'] as string | undefined;
    const correlationId = clientRequestId?.trim()
      ? clientRequestId.trim()
      : 'req_' + Date.now().toString(36) + randomBytes(8).toString('hex');
    request.headers['x-request-id'] = correlationId;
    this.cls.set('correlationId', correlationId);
    request.correlationId = correlationId;

    // lastUsedAt fire-and-forget (sin bloquear la petición).
    void firstValueFrom(
      this.dataServices.integrationCredential.update(credential.id!, {
        lastUsedAt: new Date(),
      } as any),
    ).catch(() => undefined);

    return true;
  }

  private async consumeNonce(credentialId: string, nonce: string, windowSeconds: number): Promise<void> {
    const existing = await firstValueFrom(
      this.dataServices.integrationNonce.findOne({
        where: { credentialId, nonce },
      }),
    );
    if (existing) {
      throw new IntegrationApiException(
        IntegrationErrorCode.NONCE_REPLAYED,
        'Nonce ya utilizado (posible replay).',
        HttpStatus.UNAUTHORIZED,
      );
    }
    try {
      await firstValueFrom(
        this.dataServices.integrationNonce.create({
          credentialId,
          nonce,
          expiresAt: new Date(Date.now() + windowSeconds * 1000),
        } as any),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('23505') || msg.toLowerCase().includes('duplicate')) {
        throw new IntegrationApiException(
          IntegrationErrorCode.NONCE_REPLAYED,
          'Nonce ya utilizado (posible replay).',
          HttpStatus.UNAUTHORIZED,
        );
      }
      throw err;
    }
  }

  private enforceRateLimit(credentialId: string): void {
    const limit = Number(process.env.INTEGRATION_RATE_LIMIT_PER_MIN || 60);
    const windowMs = 60_000;
    const now = Date.now();
    const stamps = (this.requestTimestamps.get(credentialId) || []).filter((t) => now - t < windowMs);
    if (stamps.length >= limit) {
      this.requestTimestamps.set(credentialId, stamps);
      throw new IntegrationApiException(
        IntegrationErrorCode.RATE_LIMITED,
        `Límite de ${limit} solicitudes por minuto alcanzado para esta credencial.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    stamps.push(now);
    this.requestTimestamps.set(credentialId, stamps);
  }
}
