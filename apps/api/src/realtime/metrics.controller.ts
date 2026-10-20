import { Controller, Delete, Get, HttpCode } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PlatformAdminOnly } from '../auth/decorators.js';
import { TransportMetrics } from './transport-metrics.js';

/** What each transport costs the server; the C10 benchmark reads it. */
@ApiTags('sync')
@PlatformAdminOnly()
@Controller('sync-metrics')
export class MetricsController {
  constructor(private readonly metrics: TransportMetrics) {}

  @Get()
  snapshot() {
    return this.metrics.snapshot();
  }

  @Delete()
  @HttpCode(204)
  reset() {
    this.metrics.reset();
  }
}
