import AppDataSource from './database/data-source';
import { validateRuntimeConfig } from './infrastructure/config/runtime-config';

async function migrate(): Promise<void> {
  validateRuntimeConfig();
  await AppDataSource.initialize();
  try {
    const migrations = await AppDataSource.runMigrations({ transaction: 'all' });
    console.log(`Migraciones aplicadas: ${migrations.length}.`);
  } finally {
    await AppDataSource.destroy();
  }
}

migrate().catch((error) => {
  console.error(`Falló la migración: ${(error as Error).message}`);
  process.exit(1);
});
