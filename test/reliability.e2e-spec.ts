import { provisionStandaloneTenant } from "../src/application/integrations/tenant-provisioning";
import { DataSource } from "typeorm";
import { randomUUID } from "node:crypto";
import { firstValueFrom, from } from "rxjs";
import * as entities from "../src/infrastructure/framework/postgres/entities";
import { PostgresGenericRepository } from "../src/infrastructure/framework/postgres/postgres-generic-repository";
import { tenantTransaction } from "../src/infrastructure/framework/postgres/tenant-transaction";
import { TenantConfigService } from "../src/infrastructure/framework/sii/tenant-config.service";
import { CafService } from "../src/infrastructure/framework/sii/caf.service";
import { Aes256Cipher } from "../src/infrastructure/framework/crypto/aes-256-cipher";
import { IntegrationStateService } from "../src/application/integrations/integration-state.service";
import { IntegrationWebhookService } from "../src/application/integrations/integration-webhook.service";
import { IntegrationProcessorService } from "../src/application/integrations/integration-processor.service";

const url = process.env.POSTGRES_E2E_URL;
(url ? describe : describe.skip)(
  "Atomic config, preparation and transactional webhook outbox",
  () => {
    let control: DataSource, db: DataSource;
    const database = "tax_reliability_" + randomUUID().replace(/-/g, "");
    const tenantId = randomUUID();
    const cls: any = {
      get: () => tenantId,
      run: (_: any, fn: any) => fn(),
      set: () => undefined,
    };
    let services: any,
      config: TenantConfigService,
      state: IntegrationStateService,
      webhook: IntegrationWebhookService;
    let cafXml: string;

    beforeAll(async () => {
      control = await new DataSource({
        type: "postgres",
        url,
        entities: [],
      }).initialize();
      await control.query(`CREATE DATABASE "${database}"`);
      const isolatedUrl = new URL(url!);
      isolatedUrl.pathname = "/" + database;
      db = await new DataSource({
        type: "postgres",
        url: isolatedUrl.toString(),
        entities: Object.values(entities),
        migrations: [__dirname + "/../src/database/migrations/*.ts"],
      }).initialize();
      await db.runMigrations({ transaction: "all" });
      await db.query(
        "INSERT INTO tenants (id,rut,business_name) VALUES ($1,$2,$3)",
        [tenantId, "76123456-7", "Reliability fixture"],
      );
      services = {};
      for (const [key, entity] of Object.entries({
        integrationRequest: entities.IntegrationRequestEntity,
        dteDocument: entities.DteDocumentEntity,
        integrationWebhookEndpoint: entities.IntegrationWebhookEndpointEntity,
        integrationWebhookEvent: entities.IntegrationWebhookEventEntity,
        integrationWebhookDelivery: entities.IntegrationWebhookDeliveryEntity,
        tenant: entities.TenantEntity,
      })) {
        services[key] = new PostgresGenericRepository(
          db.getRepository(entity),
          cls,
          key !== "tenant",
        );
      }
      process.env.SII_MASTER_KEY = "reliability-test-master-key-0123456789";
      const env: any = {
        get: (key: string, fallback: any) =>
          key === "SII_MASTER_KEY" ? process.env.SII_MASTER_KEY : fallback,
      };
      config = new TenantConfigService(
        db.getRepository(entities.TenantConfigEntity),
        services,
        new Aes256Cipher(),
        new CafService(),
        { validateCaf: async () => undefined } as any,
        env,
      );
      cafXml = new CafService().createSimulationCaf("76123456-7", 33, 1, 100);
      await config.uploadCaf(tenantId, cafXml);
      webhook = new IntegrationWebhookService(services, new Aes256Cipher());
      state = new IntegrationStateService(services, webhook, undefined, db);
      await firstValueFrom(
        services.integrationWebhookEndpoint.create({
          tenantId,
          url: "https://example.test/hook",
          secretCipher: "{}",
          secretLast4: "test",
          events: ["dte.submitted"],
          active: true,
        }),
      );
    }, 60000);

    afterAll(async () => {
      if (db?.isInitialized) await db.destroy();
      if (control?.isInitialized) {
        // Generated disposable database only, never the configured database.
        if (!/^tax_reliability_[a-f0-9]{32}$/.test(database))
          throw new Error("Unsafe database cleanup");
        await control.query(`DROP DATABASE IF EXISTS "${database}"`);
        await control.destroy();
      }
    });

    const seed = () =>
      firstValueFrom<any>(
        services.integrationRequest.create({
          tenantId,
          kind: "dte",
          state: "processing",
          resourceKey: "",
          idempotencyKey: randomUUID(),
          requestHash: "fixture",
          payload: {},
          originCredentialId: null,
          nextAttemptAt: new Date(),
          stateHistory: [],
        }),
      );

    it("preserves reserved folios across stale cached admin updates, CAF reupload and independent concurrent connections", async () => {
      await config.getConfig(tenantId);
      const other = new TenantConfigService(
        db.getRepository(entities.TenantConfigEntity),
        services,
        new Aes256Cipher(),
        new CafService(),
        {} as any,
        { get: () => undefined } as any,
      );
      const folios = await Promise.all([
        config.reserveFolioAtomic(tenantId, 33),
        other.reserveFolioAtomic(tenantId, 33),
        config.saveFolioThresholds(tenantId, { "33": 15 }),
      ]);
      expect(new Set(folios.slice(0, 2)).size).toBe(2);
      await config.uploadCaf(tenantId, cafXml);
      expect(await config.reserveFolioAtomic(tenantId, 33)).toBe(3);
      await expect(
        config.uploadCaf(
          tenantId,
          new CafService().createSimulationCaf("76123456-7", 33, 2, 101),
        ),
      ).rejects.toThrow("superpone");
    });

    for (const failAt of ["reserve", "document", "link"]) {
      it(
        "rolls back folio, document and linkage on crash after " + failAt,
        async () => {
          const request = await seed();
          const before = (
            await db.query(
              "SELECT config_json FROM tenant_configs WHERE tenant_id=$1",
              [tenantId],
            )
          )[0].config_json.cafs[0].lastUsedFolio;
          let fail = true;
          const prepare = async () => {
            const folio = await config.reserveFolioAtomic(tenantId, 33);
            if (fail && failAt === "reserve") throw new Error("injected crash");
            const dte = await firstValueFrom<any>(
              services.dteDocument.create({
                tenantId,
                type: 33,
                folio,
                receiverRut: "12345678-9",
                receiverName: "Fixture",
                amount: 1,
                xmlContent: "<DTE/>",
                status: "FIRMADO",
                brandProfileId: null,
              }),
            );
            if (fail && failAt === "document")
              throw new Error("injected crash");
            return dte;
          };
          const update = services.integrationRequest.update.bind(
            services.integrationRequest,
          );
          services.integrationRequest.update = (id: string, value: any) =>
            from(
              (async () => {
                const result = await firstValueFrom(update(id, value));
                if (fail && failAt === "link" && value.dteId)
                  throw new Error("injected crash");
                return result;
              })(),
            );
          const emit: any = {
            prepare: () => from(prepare()),
            transmit: () => from(Promise.resolve({ trackId: "TRACK-fixture" })),
          };
          const processor: any = new IntegrationProcessorService(
            services,
            cls,
            {} as any,
            state,
            emit,
            {} as any,
            {} as any,
            db,
          );
          // Bypass DTO rebuilding only: actual config/repository/transaction code is exercised.
          processor.rebuildEmitDto = () => ({});
          await processor.process(request);
          const rolledBack = await firstValueFrom<any>(
            services.integrationRequest.get(request.id),
          );
          expect(rolledBack.dteId).toBeNull();
          expect(
            (
              await db.query(
                "SELECT config_json FROM tenant_configs WHERE tenant_id=$1",
                [tenantId],
              )
            )[0].config_json.cafs[0].lastUsedFolio,
          ).toBe(before);
          expect(
            await db.query(
              "SELECT id FROM dte_documents WHERE tenant_id=$1 AND folio=$2",
              [tenantId, before + 1],
            ),
          ).toHaveLength(0);
          fail = false;
          await processor.process(rolledBack);
          const recovered = await firstValueFrom<any>(
            services.integrationRequest.get(request.id),
          );
          expect(recovered.dteId).toBeTruthy();
          expect(recovered.state).toBe("submitted");
          services.integrationRequest.update = update;
        },
      );
    }

    it("rolls back state and event if a delivery insert fails; retry commits one durable event", async () => {
      const request = await seed();
      const createDelivery = services.integrationWebhookDelivery.create.bind(
        services.integrationWebhookDelivery,
      );
      services.integrationWebhookDelivery.create = () => {
        throw new Error("delivery storage unavailable");
      };
      await expect(
        state.applyState(request, "submitted", "outbox fixture"),
      ).rejects.toThrow("delivery storage");
      expect(
        (await firstValueFrom<any>(services.integrationRequest.get(request.id)))
          .state,
      ).toBe("processing");
      expect(
        await db.query(
          "SELECT id FROM integration_webhook_events WHERE request_id=$1",
          [request.id],
        ),
      ).toHaveLength(0);
      services.integrationWebhookDelivery.create = createDelivery;
      await Promise.all([
        state.applyState(request, "submitted", "outbox fixture"),
        state.applyState(request, "submitted", "duplicate"),
      ]);
      const events = await db.query(
        "SELECT id FROM integration_webhook_events WHERE request_id=$1",
        [request.id],
      );
      expect(events).toHaveLength(1);
      expect(
        await db.query(
          "SELECT id FROM integration_webhook_deliveries WHERE event_id=$1 AND status=$2",
          [events[0].id, "pending"],
        ),
      ).toHaveLength(1);
    });

    it("reclaims a crashed delivery after its lease with the same event ID and no concurrent duplicate claim", async () => {
      const delivery = (
        await db.query(
          "SELECT id, event_id FROM integration_webhook_deliveries LIMIT 1",
        )
      )[0];
      expect(delivery).toBeDefined();
      await db.query(
        "UPDATE integration_webhook_deliveries SET status='delivering', next_attempt_at=now()-interval '1 minute' WHERE id=$1",
        [delivery.id],
      );
      const restarted: any = new IntegrationWebhookService(
        services,
        new Aes256Cipher(),
        undefined,
        cls,
        db,
      );
      const reclaimed = await restarted.claimDueDeliveries(100);
      expect(reclaimed.find((row: any) => row.id === delivery.id).eventId).toBe(
        delivery.event_id,
      );
      const second = await restarted.claimDueDeliveries(100);
      expect(second.find((row: any) => row.id === delivery.id)).toBeUndefined();
    });

    it("provisions an independent tenant/profile atomically and refuses duplicates and T46 activation", async () => {
      const input = {
        tenantId: randomUUID(),
        rut: "76086428-5",
        businessName: "Provision fixture",
        taxProfile: {
          giro: "Servicios",
          activities: ["620100"],
          address: "Calle 1",
          commune: "Santiago",
          city: "Santiago",
          resolutionDate: "2026-01-01",
          resolutionNumber: 0,
        },
      };
      await provisionStandaloneTenant(db, input);
      expect(
        await db.query("SELECT id FROM tenant_configs WHERE tenant_id=$1", [
          input.tenantId,
        ]),
      ).toHaveLength(1);
      await expect(provisionStandaloneTenant(db, input)).rejects.toThrow();
      const invalid = {
        ...input,
        tenantId: randomUUID(),
        taxProfile: { ...input.taxProfile, canIssueT46: true },
      };
      await expect(provisionStandaloneTenant(db, invalid)).rejects.toThrow(
        "T46",
      );
      expect(
        await db.query("SELECT id FROM tenants WHERE id=$1", [
          invalid.tenantId,
        ]),
      ).toHaveLength(0);
    });

    it("rejects a nested cross-tenant transaction", async () => {
      await expect(
        tenantTransaction(db.manager, tenantId, () =>
          tenantTransaction(db.manager, randomUUID(), async () => undefined),
        ),
      ).rejects.toThrow("Cross-tenant");
    });
  },
);
