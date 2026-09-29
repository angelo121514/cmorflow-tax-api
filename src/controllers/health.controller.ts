// src/controllers/health.controller.ts
import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiExtension } from '@nestjs/swagger';
import { Public } from '../infrastructure/decorators/public.decorator';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { DEFAULT_SII_MASTER_KEY } from '../infrastructure/framework/sii/sii-defaults.constant';

@ApiTags('health')
@Controller()
export class HealthController {
  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
  ) {}

  @Get('health')
  @Public()
  @ApiExtension('x-auth-type', 'public')
  @ApiOperation({ summary: 'Proceso vivo (liveness)' })
  health() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Get('ready')
  @Public()
  @ApiExtension('x-auth-type', 'public')
  @ApiOperation({ summary: 'Listo para tráfico (readiness): Postgres + config + crypto' })
  async ready(@Res({ passthrough: true }) response: Response) {
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
    const key = this.configService.get<string>('SII_MASTER_KEY');
    checks.masterKey = key && key !== DEFAULT_SII_MASTER_KEY && key.length >= 32 ? 'ok' : 'missing_or_unsafe';

    const allOk = Object.values(checks).every((v) => v === 'ok' || v === 'disabled');
    if (!allOk) response.status(HttpStatus.SERVICE_UNAVAILABLE);
    return {
      status: allOk ? 'ready' : 'not_ready',
      checks,
      timestamp: new Date().toISOString(),
    };
  }
}
