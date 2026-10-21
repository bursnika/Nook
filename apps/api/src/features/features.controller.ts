import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { RequireFeature, Roles } from '../auth/decorators.js';
import { WorkspaceParams } from '../common/params.js';
import { Plan, Role } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { WorkspacesService } from '../workspaces/workspaces.service.js';
import { FeaturesService } from './features.service.js';
import { activityByDay, insightsSince, weeklyCompleted } from './insights.js';

class ChangePlanDto {
  @IsEnum(Plan)
  plan!: Plan;
}

@ApiTags('features')
@Controller('workspaces/:workspaceId')
export class FeaturesController {
  constructor(
    private readonly features: FeaturesService,
    private readonly workspaces: WorkspacesService,
    private readonly prisma: PrismaService,
  ) {}

  /** What the workspace can use right now, so the UI can show or hide Pro-only parts. */
  @Get('features')
  async list(@Param() { workspaceId }: WorkspaceParams) {
    const [workspace, features] = await Promise.all([
      this.workspaces.get(workspaceId),
      this.features.list(workspaceId),
    ]);
    return { plan: workspace.plan, features };
  }

  /** Stand-in for billing: owners switch the plan themselves. */
  @Post('plan')
  @HttpCode(200)
  @Roles(Role.OWNER)
  changePlan(@Param() { workspaceId }: WorkspaceParams, @Body() { plan }: ChangePlanDto) {
    return this.workspaces.setPlan(workspaceId, plan);
  }

  /** The Pro-only Insights page: how work is going in this workspace. */
  @Get('insights')
  @RequireFeature('insights')
  async insights(@Param() { workspaceId }: WorkspaceParams) {
    const now = new Date();
    const since = insightsSince(now);
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const [
      byStatus,
      byPriority,
      completedLastWeek,
      overdue,
      pages,
      completed,
      created,
      pagesCreated,
    ] = await Promise.all([
      this.prisma.task.groupBy({ by: ['status'], where: { workspaceId }, _count: { _all: true } }),
      this.prisma.task.groupBy({
        by: ['priority'],
        where: { workspaceId },
        _count: { _all: true },
      }),
      this.prisma.task.count({ where: { workspaceId, completedAt: { gte: weekAgo } } }),
      this.prisma.task.count({
        where: { workspaceId, status: { not: 'DONE' }, dueDate: { lt: now } },
      }),
      this.prisma.page.count({ where: { workspaceId } }),
      this.prisma.task.findMany({
        where: { workspaceId, completedAt: { gte: since } },
        select: { completedAt: true },
      }),
      this.prisma.task.findMany({
        where: { workspaceId, createdAt: { gte: since } },
        select: { createdAt: true },
      }),
      this.prisma.page.findMany({
        where: { workspaceId, createdAt: { gte: since } },
        select: { createdAt: true },
      }),
    ]);
    const completedAt = completed.flatMap((t) => (t.completedAt ? [t.completedAt] : []));
    return {
      tasksByStatus: Object.fromEntries(byStatus.map((row) => [row.status, row._count._all])),
      tasksByPriority: {
        LOW: 0,
        MEDIUM: 0,
        HIGH: 0,
        ...Object.fromEntries(byPriority.map((row) => [row.priority, row._count._all])),
      },
      completedLastWeek,
      overdue,
      pages,
      weeklyCompleted: weeklyCompleted(completedAt, now),
      activity: activityByDay(
        [
          ...completedAt,
          ...created.map((t) => t.createdAt),
          ...pagesCreated.map((p) => p.createdAt),
        ],
        now,
      ),
    };
  }
}
