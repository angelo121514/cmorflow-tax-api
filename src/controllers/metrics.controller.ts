import { Controller, Get, Header, Headers, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { ApiExcludeController } from '@nestjs/swagger';
import { PrometheusService } from '../infrastructure/logger/prometheus.service';

@ApiExcludeController()
@Controller()
export class MetricsController {
  constructor(private readonly metrics: PrometheusService) {}

  @Get('metrics')
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  async getMetrics(@Headers('authorization') authorization?: string): Promise<string> {
    // Keep metrics disabled by default in production; expose it only behind an
    // infrastructure-level private network or an explicitly enabled scraper.
    if (process.env.NODE_ENV === 'production') {
      const secret = process.env.METRICS_BEARER_TOKEN || '';
      const supplied = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
      const left = Buffer.from(secret);
      const right = Buffer.from(supplied);
      if (!process.env.METRICS_ENABLED?.match(/^true$/i) || !secret || left.length !== right.length || !timingSafeEqual(left, right)) {
        throw new UnauthorizedException();
      }
    }
    return this.metrics.getMetrics();
  }
}
