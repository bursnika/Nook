import { Get, Param, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';
import { PlatformAdminOnly } from '../auth/decorators.js';
import { WorkspaceParams } from '../common/params.js';
import { AdminController } from './admin-controller.decorator.js';
import { LookupService } from './lookup.service.js';

class LookupQuery {
  @IsOptional()
  @IsString()
  q: string = '';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;
}

@AdminController('admin')
export class LookupController {
  constructor(private readonly lookup: LookupService) {}

  @Get('lookup/users')
  @PlatformAdminOnly()
  users(@Query() { q, page }: LookupQuery) {
    return this.lookup.users(q.trim(), page);
  }

  @Get('workspaces/:workspaceId/lookup/members')
  members(@Param() { workspaceId }: WorkspaceParams, @Query() { q, page }: LookupQuery) {
    return this.lookup.members(workspaceId, q.trim(), page);
  }

  @Get('workspaces/:workspaceId/lookup/pages')
  pages(@Param() { workspaceId }: WorkspaceParams, @Query() { q, page }: LookupQuery) {
    return this.lookup.pages(workspaceId, q.trim(), page);
  }
}
