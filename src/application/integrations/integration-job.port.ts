// backend/src/application/integrations/integration-job.port.ts
/**
 * Puerto (abstracción) para el procesamiento de jobs asíncronos de la API B2B.
 *
 * Implementación actual: CronIntegrationWorker — disparado por GitHub Actions
 * que llama a los endpoints internal/cron (HMAC). La BD es la fuente de verdad
 * y cada tick es idempotente.
 *
 * Implementación futura posible: BullMQIntegrationWorker, PgBossIntegrationWorker,
 * o un worker in-process con setInterval — sin tocar los use cases que consumen
 * este puerto.
 */
export interface IntegrationJobPort {
  /** Tick completo del reconciler: cola vencida + polling SII + webhooks + purge. */
  tick(): Promise<any>;

  /** Sólo entregas de webhooks vencidas (más frecuente que el tick completo). */
  deliverWebhooks(): Promise<any>;

  /** RCOF diario automático por tenant (zona America/Santiago). */
  rcofDaily(): Promise<any>;
}