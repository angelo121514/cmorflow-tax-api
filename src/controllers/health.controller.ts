// src/controllers/health.controller.ts
import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Public } from '../infrastructure/decorators/public.decorator';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';

@ApiTags('health')
@Controller()
export class HealthController {
  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
  ) {}

  @Get('health')
  @Public()
  @ApiOperation({ summary: 'Proceso vivo (liveness)' })
  health() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Get('ready')
  @Public()
  @ApiOperation({ summary: 'Listo para tráfico (readiness): Postgres + config + crypto' })
  async ready() {
    const checks: Record<string, string> = {};

    // Postgres
    try {
      await this.dataSource.query('SELECT 1');
      checks.postgres = 'ok';
    } catch {
      checks.postgres = 'fail';
    }

    // Config obligatoria
    checks.integrationsEnabled = this.configService.get('INTEGRATIONS_API_ENABLED') === 'true' ? 'ok' : 'disabled';
    checks.masterKey = this.configService.get('SII_MASTER_KEY') ? 'ok' : 'missing';

    const allOk = Object.values(checks).every((v) => v === 'ok' || v === 'disabled');
    return {
      status: allOk ? 'ready' : 'not_ready',
      checks,
      timestamp: new Date().toISOString(),
    };
  }
}