import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators.js';
import { CACHE_TTL_SECONDS, CacheService, setCacheHeader } from '../cache/cache.service.js';
import { WorkspaceParams } from '../common/params.js';
import { CalendarRangeQuery } from './overview.dto.js';
import { OverviewService } from './overview.service.js';

@ApiTags('overview')
@Controller('workspaces/:workspaceId')
export class OverviewController {
  constructor(
    private readonly overview: OverviewService,
    private readonly cache: CacheService,
  ) {}

  /** Tasks due in the next 24 hours, high-priority and open tasks. */
  @Get('overview')
  async summary(
    @Param() { workspaceId }: WorkspaceParams,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { value, hit } = await this.cache.remember(
      this.cache.listKey(workspaceId, 'overview'),
      CACHE_TTL_SECONDS.overview,
      () => this.overview.summary(workspaceId),
    );
    setCacheHeader(res, hit);
    return value;
  }

  /** Not cached: it carries the viewer's own Google rights, so two members get different answers. */
  @Get('calendar')
  calendar(
    @Param() { workspaceId }: WorkspaceParams,
    @Query() { from, to }: CalendarRangeQuery,
    @CurrentUser() user: AuthUser,
  ) {
    return this.overview.calendar(workspaceId, user.id, from, to);
  }
}
