import { DataSource } from "typeorm";
import { randomUUID } from "node:crypto";
import { validateRut } from "../../infrastructure/decorators/is-chilean-rut.decorator";
import { tenantTransaction } from "../../infrastructure/framework/postgres/tenant-transaction";
import type { TenantTaxProfile } from "../../infrastructure/framework/sii/tenant-config.service";

export interface StandaloneTenantInput {
  tenantId: string;
  rut: string;
  businessName: string;
  taxProfile: TenantTaxProfile;
}

export function validateTenantInput(input: StandaloneTenantInput): void {
  if (
    !input ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      input.tenantId,
    )
  )
    throw new Error("tenantId UUID requerido.");
  if (
    typeof input.rut !== "string" ||
    !validateRut(input.rut) ||
    input.rut.length > 12
  )
    throw new Error("RUT inválido.");
  if (
    typeof input.businessName !== "string" ||
    !input.businessName.trim() ||
    input.businessName.length > 255
  )
    throw new Error("Razón social inválida.");
  const p = input.taxProfile;
  if (
    !p ||
    ["giro", "address", "commune", "city"].some(
      (field) =>
        typeof (p as any)[field] !== "string" || !(p as any)[field].trim(),
    )
  )
    throw new Error("Perfil tributario incompleto.");
  if (
    !Array.isArray(p.activities) ||
    !p.activities.length ||
    p.activities.some(
      (value) => typeof value !== "string" || !/^\d{4,8}$/.test(value),
    )
  )
    throw new Error("Actividades inválidas.");
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(p.resolutionDate || "") ||
    !Number.isFinite(Date.parse(p.resolutionDate)) ||
    new Date(p.resolutionDate).toISOString().slice(0, 10) !==
      p.resolutionDate ||
    !Number.isInteger(p.resolutionNumber) ||
    p.resolutionNumber < 0
  )
    throw new Error("Resolución inválida.");
  if (p.canIssueT46)
    throw new Error(
      "T46 requiere autorización externa; no se habilita mediante provisioning.",
    );
}

/** Only for a separately owned Tax API database, never ERP-shared provisioning. */
export async function provisionStandaloneTenant(
  db: DataSource,
  input: StandaloneTenantInput,
): Promise<{ tenantId: string }> {
  validateTenantInput(input);
  return tenantTransaction(db.manager, input.tenantId, async (manager) => {
    await manager.query(
      "INSERT INTO tenants (id, rut, business_name) VALUES ($1, $2, $3)",
      [input.tenantId, input.rut, input.businessName.trim()],
    );
    await manager.query(
      "INSERT INTO tenant_configs (tenant_id, config_json) VALUES ($1, $2::jsonb)",
      [
        input.tenantId,
        JSON.stringify({
          cafs: [],
          taxProfile: { ...input.taxProfile, canIssueT46: false },
        }),
      ],
    );
    await manager.query(
      "INSERT INTO audit_logs (id,tenant_id,action,payload) VALUES ($1,$2,$3,$4::jsonb)",
      [
        randomUUID(),
        input.tenantId,
        "TENANT_PROVISIONED",
        JSON.stringify({ source: "standalone-cli" }),
      ],
    );
    return { tenantId: input.tenantId };
  });
}
