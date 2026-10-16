import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { WorkspaceParams } from '../common/params.js';
import { CalendarRangeQuery } from './overview.dto.js';
import { OverviewService } from './overview.service.js';

@ApiTags('overview')
@Controller('workspaces/:workspaceId')
export class OverviewController {
  constructor(private readonly overview: OverviewService) {}

  /** Tasks due in the next 24 hours, high-priority and open tasks. */
  @Get('overview')
  summary(@Param() { workspaceId }: WorkspaceParams) {
    return this.overview.summary(workspaceId);
  }

  @Get('calendar')
  calendar(@Param() { workspaceId }: WorkspaceParams, @Query() { from, to }: CalendarRangeQuery) {
    return this.overview.calendar(workspaceId, from, to);
  }
}
