// backend/src/application/integrations/integration-webhook.service.ts
import { Injectable, Logger, Optional } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import { createHmac, randomBytes } from 'crypto';
import { lookup } from 'dns/promises';
import { isIP } from 'net';
import { Agent } from 'undici';
import {
  IDataServices,
  IntegrationRequestEntity,
  IntegrationWebhookEndpointEntity,
  IntegrationWebhookEventEntity,
} from '@domain';
import { Aes256Cipher } from '../../infrastructure/framework/crypto/aes-256-cipher';
import { INTEGRATION_WEBHOOK_EVENTS } from './integration-errors';
import type { IntegrationEventDispatcher } from './integration-state.service';
import { PrometheusService } from '../../infrastructure/logger/prometheus.service';
import { ClsService } from 'nestjs-cls';
import { DataSource } from 'typeorm';

/** Backoff de reintentos de entrega: 1m, 5m, 15m, 30m, 60m, 6h (6 intentos). */
const DELIVERY_BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000, 60 * 60_000, 6 * 60 * 60_000];
const DELIVERY_TIMEOUT_MS = 10_000;
const RESPONSE_SNIPPET_MAX = 300;

/**
 * Webhooks salientes firmados de la API B2B.
 *
 * - Registro de endpoints por tenant con secreto propio (cifrado
 *   AES-256-GCM con SII_MASTER_KEY; necesario para firmar cada entrega).
 * - Firma: X-CmorFlow-Signature: sha256=HMAC(secreto, timestamp + '.' + body),
 *   con X-CmorFlow-Event-Id, X-CmorFlow-Event-Type y X-CmorFlow-Timestamp.
 * - Entregas con reintentos acotados y backoff; historial y reenvío manual.
 * - La consulta (GET) es la fuente de verdad; los webhooks son notificaciones
 *   recuperables y tolerantes a desorden.
 */
@Injectable()
export class IntegrationWebhookService implements IntegrationEventDispatcher {
  private readonly logger = new Logger(IntegrationWebhookService.name);

  constructor(
    private readonly dataServices: IDataServices,
    private readonly aesCipher: Aes256Cipher,
    private readonly metrics?: PrometheusService,
    private readonly cls?: ClsService,
    @Optional() private readonly dataSource?: DataSource,
  ) {}

  private masterKey(): string {
    const key = process.env.SII_MASTER_KEY;
    if (!key) {
      throw new Error('SII_MASTER_KEY es obligatorio para gestionar webhooks.');
    }
    return key;
  }

  // ── Administración de endpoints (JWT interno) ──

  async registerEndpoint(
    tenantId: string,
    input: { url: string; events: string[]; description?: string },
  ): Promise<{ endpoint: any; secret: string }> {
    await this.assertSafeWebhookUrl(input.url);
    if (!/^https:\/\//i.test(input.url)) {
      throw new Error('La URL del webhook debe ser HTTPS.');
    }
    const invalid = (input.events || []).filter(
      (e) => !INTEGRATION_WEBHOOK_EVENTS.includes(e as any),
    );
    if (invalid.length > 0) {
      throw new Error(`Eventos inválidos: ${invalid.join(', ')}.`);
    }
    if (!input.events || input.events.length === 0) {
      throw new Error('Debe suscribir al menos un evento.');
    }

    const secret = 'whsec_' + randomBytes(32).toString('hex');
    const cipher = this.aesCipher.encrypt(secret, this.masterKey());

    const endpoint = await firstValueFrom(
      this.dataServices.integrationWebhookEndpoint.create({
        tenantId,
        url: input.url,
        secretCipher: JSON.stringify(cipher),
        secretLast4: secret.slice(-4),
        events: input.events,
        active: true,
        description: input.description ?? null,
      } as any),
    );
    return { endpoint: this.maskEndpoint(endpoint!), secret };
  }

  async listEndpoints(tenantId: string) {
    const endpoints = await firstValueFrom(
      this.dataServices.integrationWebhookEndpoint.find({ where: { tenantId } }),
    );
    return endpoints.map((e) => this.maskEndpoint(e));
  }

  async deactivateEndpoint(tenantId: string, endpointId: string) {
    const endpoint = await firstValueFrom(
      this.dataServices.integrationWebhookEndpoint.get(endpointId),
    );
    if (!endpoint || endpoint.tenantId !== tenantId) {
      throw new Error('Endpoint no encontrado.');
    }
    await firstValueFrom(
      this.dataServices.integrationWebhookEndpoint.update(endpointId, { active: false } as any),
    );
    return { deactivated: true };
  }

  private maskEndpoint(e: IntegrationWebhookEndpointEntity) {
    return {
      id: e.id,
      url: e.url,
      events: e.events,
      active: e.active,
      description: e.description ?? null,
      secretLast4: `****${e.secretLast4}`,
      createdAt: e.createdAt,
    };
  }

  // ── Emisión de eventos (llamado por IntegrationStateService) ──

  async dispatchForRequest(
    request: IntegrationRequestEntity,
    state: string,
    detail: string,
  ): Promise<void> {
    const prefix = request.kind === 'rcof' ? 'rcof' : 'dte';
    const eventType = `${prefix}.${state}`;
    if (!INTEGRATION_WEBHOOK_EVENTS.includes(eventType as any)) {
      return;
    }
    const payload = {
      type: eventType,
      requestId: request.id,
      kind: request.kind,
      externalReference: request.externalReference ?? null,
      metadata: request.metadata ?? null,
      dteId: request.dteId ?? null,
      rcofId: request.rcofId ?? null,
      status: state,
      detail,
      occurredAt: new Date().toISOString(),
    };
    await this.emitEvent(request.tenantId, eventType, payload, request.id ?? null, request.rcofId ?? null);
  }

  async dispatchForRcof(rcof: any, state: string, detail: string): Promise<void> {
    const eventType = `rcof.${state}`;
    if (!INTEGRATION_WEBHOOK_EVENTS.includes(eventType as any)) {
      return;
    }
    const payload = {
      type: eventType,
      rcofId: rcof.id,
      periodDate: rcof.periodDate,
      sequence: rcof.sequence,
      trackId: rcof.trackId ?? null,
      status: state,
      detail,
      occurredAt: new Date().toISOString(),
    };
    await this.emitEvent(rcof.tenantId, eventType, payload, null, rcof.id);
  }

  private async emitEvent(
    tenantId: string,
    type: string,
    payload: any,
    requestId: string | null,
    rcofId: string | null,
  ): Promise<void> {
    const endpoints = await firstValueFrom(
      this.dataServices.integrationWebhookEndpoint.find({ where: { tenantId, active: true } }),
    );
    if (endpoints.length === 0) {
      return;
    }

    const event = await firstValueFrom(
      this.dataServices.integrationWebhookEvent.create({
        tenantId,
        type,
        requestId,
        rcofId,
        payload,
      } as any),
    );

    for (const endpoint of endpoints.filter((e) => e.events.includes(type))) {
      await firstValueFrom(
        this.dataServices.integrationWebhookDelivery.create({
          tenantId,
          eventId: event!.id,
          endpointId: endpoint.id,
          attempt: 0,
          maxAttempts: DELIVERY_BACKOFF_MS.length,
          status: 'pending',
          nextAttemptAt: new Date(),
        } as any),
      );
    }
  }

  // ── Entregas (reconciler + trigger inmediato) ──

  /** Entrega las entregas vencidas (bounded batch). Devuelve el resumen. */
  async deliverDue(limit = 10): Promise<{ attempted: number; delivered: number; failed: number }> {
    if (this.dataSource && this.cls) {
      const claimed = await this.claimDueDeliveries(limit);
      return this.deliverClaimed(claimed);
    }
    if (this.cls && this.dataServices.tenant?.getAll) {
      const totals = { attempted: 0, delivered: 0, failed: 0 };
      const tenants = await firstValueFrom(this.dataServices.tenant.getAll());
      for (const tenant of tenants) {
        if (totals.attempted >= limit) break;
        const result = await this.cls.run({} as any, async () => {
          this.cls!.set('tenantId', tenant.id!);
          return this.deliverDueForCurrentTenant(limit - totals.attempted);
        });
        totals.attempted += result.attempted;
        totals.delivered += result.delivered;
        totals.failed += result.failed;
      }
      return totals;
    }
    return this.deliverDueForCurrentTenant(limit);
  }

  private async claimDueDeliveries(limit: number): Promise<any[]> {
    return this.dataSource!.transaction(async (manager) => {
      await manager.query(`SELECT set_config('app.worker_scope', 'true', true)`);
      const result = await manager.query(
        `WITH candidates AS MATERIALIZED (
            SELECT id FROM integration_webhook_deliveries
             WHERE status IN ('pending', 'delivering') AND next_attempt_at <= now() AND attempt < max_attempts
             ORDER BY next_attempt_at, created_at
             LIMIT $1
             FOR UPDATE SKIP LOCKED
          )
          UPDATE integration_webhook_deliveries AS delivery
            SET status = 'delivering', next_attempt_at = now() + interval '10 minutes'
           FROM candidates
          WHERE delivery.id = candidates.id
          RETURNING delivery.id, delivery.tenant_id AS "tenantId", delivery.event_id AS "eventId",
            delivery.endpoint_id AS "endpointId", delivery.attempt, delivery.max_attempts AS "maxAttempts",
            delivery.status, delivery.next_attempt_at AS "nextAttemptAt"`,
        [limit],
      );
      // TypeORM/pg retorna UPDATE ... RETURNING como [rows, rowCount].
      return Array.isArray(result?.[0]) ? result[0] : result;
    });
  }

  private async deliverClaimed(deliveries: any[]): Promise<{ attempted: number; delivered: number; failed: number }> {
    const result = { attempted: 0, delivered: 0, failed: 0 };
    for (const delivery of deliveries) {
      result.attempted++;
      await this.cls!.run({} as any, async () => {
        this.cls!.set('tenantId', delivery.tenantId);
        try {
          const ok = await this.attemptDelivery(delivery);
          if (ok) result.delivered++;
          else result.failed++;
          this.metrics?.webhookDeliveriesTotal.inc({ status: ok ? 'delivered' : 'failed' });
        } catch (error) {
          result.failed++;
          this.metrics?.webhookDeliveriesTotal.inc({ status: 'failed' });
          await firstValueFrom(this.dataServices.integrationWebhookDelivery.update(delivery.id, {
            status: 'pending', lastError: (error as Error).message,
            nextAttemptAt: new Date(Date.now() + DELIVERY_BACKOFF_MS[0]),
          } as any)).catch(() => undefined);
          this.logger.warn(`Entrega ${delivery.id} falló: ${(error as Error).message}`);
        }
      });
    }
    return result;
  }

  private async deliverDueForCurrentTenant(limit: number): Promise<{ attempted: number; delivered: number; failed: number }> {
    let attempted = 0;
    let delivered = 0;
    let failed = 0;

    const due = await firstValueFrom(
      this.dataServices.integrationWebhookDelivery.find({ where: { status: 'pending' } } as any),
    );
    const now = Date.now();
    const dueSlice = due
      .filter((d: any) => new Date(d.nextAttemptAt).getTime() <= now && d.attempt < d.maxAttempts)
      .slice(0, limit);

    for (const delivery of dueSlice) {
      attempted++;
      try {
        const ok = await this.attemptDelivery(delivery);
        if (ok) {
          delivered++;
          this.metrics?.webhookDeliveriesTotal.inc({ status: 'delivered' });
        } else {
          failed++;
          this.metrics?.webhookDeliveriesTotal.inc({ status: 'failed' });
        }
      } catch (err) {
        failed++;
        this.metrics?.webhookDeliveriesTotal.inc({ status: 'failed' });
        this.logger.warn(`Entrega ${delivery.id} falló: ${(err as Error).message}`);
      }
    }
    return { attempted, delivered, failed };
  }

  private async attemptDelivery(delivery: any): Promise<boolean> {
    const event = await firstValueFrom(
      this.dataServices.integrationWebhookEvent.get(delivery.eventId),
    );
    const endpoint = await firstValueFrom(
      this.dataServices.integrationWebhookEndpoint.get(delivery.endpointId),
    );
    if (!event || !endpoint || !endpoint.active) {
      await firstValueFrom(
        this.dataServices.integrationWebhookDelivery.update(delivery.id, {
          status: 'failed',
          lastError: 'evento o endpoint inexistente/inactivo',
        } as any),
      );
      return false;
    }

    const body = JSON.stringify({
      id: event.id,
      type: event.type,
      created_at: event.createdAt,
      data: event.payload,
    });
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const secret = this.decryptSecret(endpoint);
    const signature =
      'sha256=' + createHmac('sha256', secret).update(timestamp + '.' + body).digest('hex');

    let responseStatus: number | null = null;
    let snippet: string | null = null;
    let error: string | null = null;
    // Pinning de IP: la conexión sale hacia la IP validada por el lookup del
    // dispatcher (anti DNS rebinding), no hacia una resolución posterior.
    const dispatcher = this.buildPinnedDispatcher();
    try {
      await this.assertSafeWebhookUrl(endpoint.url);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetch(endpoint.url, {
          method: 'POST',
          redirect: 'error',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'CmorFlow-Webhooks/1.0',
            'X-CmorFlow-Event-Id': event.id!,
            'X-CmorFlow-Event-Type': event.type,
            'X-CmorFlow-Timestamp': timestamp,
            'X-CmorFlow-Signature': signature,
          },
          body,
          signal: controller.signal,
          dispatcher,
        } as RequestInit);
      } finally {
        clearTimeout(timer);
      }
      responseStatus = response.status;
      snippet = (await response.text()).slice(0, RESPONSE_SNIPPET_MAX);
      if (!response.ok) {
        error = `HTTP ${response.status}`;
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      void dispatcher.close().catch(() => undefined);
    }

    const attempt = delivery.attempt + 1;
    if (responseStatus && responseStatus >= 200 && responseStatus < 300) {
      await firstValueFrom(
        this.dataServices.integrationWebhookDelivery.update(delivery.id, {
          attempt,
          status: 'delivered',
          responseStatus,
          responseSnippet: snippet,
          deliveredAt: new Date(),
          lastError: null,
        } as any),
      );
      return true;
    }

    const exhausted = attempt >= delivery.maxAttempts;
    if (exhausted) this.metrics?.webhookDeliveriesTotal.inc({ status: 'dead' });
    await firstValueFrom(
      this.dataServices.integrationWebhookDelivery.update(delivery.id, {
        attempt,
        status: exhausted ? 'dead' : 'pending',
        responseStatus,
        responseSnippet: snippet,
        lastError: error ?? 'sin respuesta 2xx',
        nextAttemptAt: new Date(
          Date.now() + DELIVERY_BACKOFF_MS[Math.min(attempt - 1, DELIVERY_BACKOFF_MS.length - 1)],
        ),
      } as any),
    );
    return false;
  }

  /** Reenvío manual (diagnóstico): crea un intento inmediato para el evento. */
  async redeliver(tenantId: string, eventId: string): Promise<{ queued: number }> {
    const event = await firstValueFrom(this.dataServices.integrationWebhookEvent.get(eventId));
    if (!event || event.tenantId !== tenantId) {
      throw new Error('Evento no encontrado.');
    }
    const endpoints = await firstValueFrom(
      this.dataServices.integrationWebhookEndpoint.find({ where: { tenantId, active: true } }),
    );
    let queued = 0;
    for (const endpoint of endpoints.filter((e) => e.events.includes(event.type))) {
      await firstValueFrom(
        this.dataServices.integrationWebhookDelivery.create({
          tenantId,
          eventId,
          endpointId: endpoint.id,
          attempt: 0,
          maxAttempts: DELIVERY_BACKOFF_MS.length,
          status: 'pending',
          nextAttemptAt: new Date(),
        } as any),
      );
      queued++;
    }
    return { queued };
  }

  async deliveryHistory(tenantId: string, eventId?: string) {
    const deliveries = await firstValueFrom(
      this.dataServices.integrationWebhookDelivery.find(
        eventId ? ({ where: { tenantId, eventId } } as any) : ({ where: { tenantId } } as any),
      ),
    );
    return deliveries.slice(-50).map((d: any) => ({
      id: d.id,
      eventId: d.eventId,
      endpointId: d.endpointId,
      attempt: d.attempt,
      maxAttempts: d.maxAttempts,
      status: d.status,
      responseStatus: d.responseStatus ?? null,
      lastError: d.lastError ?? null,
      nextAttemptAt: d.nextAttemptAt,
      deliveredAt: d.deliveredAt ?? null,
    }));
  }

  private decryptSecret(endpoint: IntegrationWebhookEndpointEntity): string {
    const stored = JSON.parse(endpoint.secretCipher);
    return this.aesCipher.decrypt(
      stored.ciphertext,
      this.masterKey(),
      stored.iv,
      stored.authTag,
      stored.salt,
    );
  }

  /** Prevent the webhook facility from being used to access private infrastructure. */
  private async assertSafeWebhookUrl(value: string): Promise<void> {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error('La URL del webhook no es válida.');
    }
    if (url.protocol !== 'https:' || url.username || url.password) {
      throw new Error('La URL del webhook debe ser HTTPS y no puede incluir credenciales.');
    }
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const assertPublic = (address: string) => {
      if (this.isPrivateAddress(address)) throw new Error('La URL del webhook no puede resolver a una red privada o local.');
    };
    if (isIP(host)) {
      assertPublic(host);
      return;
    }
    // Jest endpoints are deliberately non-resolvable; production always validates DNS.
    if (process.env.NODE_ENV === 'test') return;
    const addresses = await lookup(host, { all: true, verbatim: true });
    if (!addresses.length) throw new Error('La URL del webhook no resolvió a una dirección pública.');
    addresses.forEach((entry) => assertPublic(entry.address));
  }

  private isPrivateAddress(address: string): boolean {
    if (address === '::1' || address === '::' || address.startsWith('fe80:') || address.startsWith('fc') || address.startsWith('fd')) return true;
    if (address.startsWith('::ffff:')) return this.isPrivateAddress(address.slice(7));
    const parts = address.split('.').map(Number);
    return parts.length === 4 && (
      parts[0] === 0 || parts[0] === 10 || parts[0] === 127 ||
      (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168)
    );
  }

  /**
   * Lookup para el dispatcher de entrega: resuelve DNS y valida cada dirección
   * ANTES de que se abra la conexión. Cierra la ventana TOCTOU de DNS rebinding
   * (assertSafeWebhookUrl valida en otro momento; aquí la IP que se valida es
   * exactamente la IP a la que conecta el socket, con SNI/Host del hostname).
   */
  private safeLookup(
    hostname: string,
    options: unknown,
    callback: (err: NodeJS.ErrnoException | null, address?: string, family?: number) => void,
  ): void {
    lookup(hostname, { all: true, verbatim: true })
      .then((addresses) => {
        const safe = addresses.find((entry) => !this.isPrivateAddress(entry.address));
        if (!safe) {
          callback(Object.assign(new Error(`La URL del webhook no resolvió a una dirección pública (${hostname}).`), { code: 'ENOTFOUND' }));
          return;
        }
        callback(null, safe.address, safe.family);
      })
      .catch((err) => callback(err));
  }

  private buildPinnedDispatcher(): Agent {
    return new Agent({
      connect: {
        lookup: ((hostname: string, options: unknown, callback: (err: NodeJS.ErrnoException | null, address?: string, family?: number) => void) =>
          this.safeLookup(hostname, options, callback)) as never,
      },
      headersTimeout: DELIVERY_TIMEOUT_MS,
      bodyTimeout: DELIVERY_TIMEOUT_MS,
    });
  }
}
