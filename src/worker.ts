import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { validateRuntimeConfig } from './infrastructure/config/runtime-config';

async function bootstrapWorker(): Promise<void> {
  validateRuntimeConfig();
  if (process.env.INTEGRATION_WORKER_ENABLED !== 'true') {
    throw new Error('El proceso worker requiere INTEGRATION_WORKER_ENABLED=true.');
  }
  const app = await NestFactory.createApplicationContext(AppModule);
  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    console.log(`Worker recibió ${signal}; drenando trabajo en curso...`);
    await app.close();
    process.exit(0);
  };
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
  console.log('CmorFlow Tax worker iniciado.');
}

bootstrapWorker().catch((error) => {
  console.error(`No se pudo iniciar CmorFlow Tax worker: ${(error as Error).message}`);
  process.exit(1);
});
