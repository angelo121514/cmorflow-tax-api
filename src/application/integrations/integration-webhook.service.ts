// backend/src/application/integrations/integration-webhook.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import { createHmac } from 'crypto';
import {
  IDataServices,
  IntegrationRequestEntity,
  IntegrationWebhookEndpointEntity,
  IntegrationWebhookEventEntity,
} from '@domain';
import { Aes256Cipher } from '../../infrastructure/framework/crypto/aes-256-cipher';
import { INTEGRATION_WEBHOOK_EVENTS } from './integration-errors';
import type { IntegrationEventDispatcher } from './integration-state.service';

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

    const secret = 'whsec_' + createHmac('sha256', Math.random().toString()).update(String(Date.now())).digest('hex');
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
        } else {
          failed++;
        }
      } catch (err) {
        failed++;
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
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
      const response = await fetch(endpoint.url, {
        method: 'POST',
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
      });
      clearTimeout(timer);
      responseStatus = response.status;
      snippet = (await response.text()).slice(0, RESPONSE_SNIPPET_MAX);
      if (!response.ok) {
        error = `HTTP ${response.status}`;
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
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
}
