import { readFileSync } from "node:fs";
import AppDataSource from "../src/database/data-source";
import {
  provisionStandaloneTenant,
  validateTenantInput,
} from "../src/application/integrations/tenant-provisioning";

async function main(): Promise<void> {
  const [mode, filename] = process.argv.slice(2);
  if (mode !== "--standalone" || !filename)
    throw new Error(
      "Uso: npm run tenant:provision -- --standalone perfil.json (base independiente únicamente).",
    );
  const input = JSON.parse(readFileSync(filename, "utf8"));
  validateTenantInput(input);
  await AppDataSource.initialize();
  try {
    console.log(
      JSON.stringify(await provisionStandaloneTenant(AppDataSource, input)),
    );
  } finally {
    await AppDataSource.destroy();
  }
}
main().catch(() => {
  console.error(
    "Provisioning falló. Revisa el archivo, instalación independiente, permisos y duplicados. No se modifican tenants existentes.",
  );
  process.exitCode = 1;
});
