import { Injectable } from '@nestjs/common';
import { Plan } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';

const PLAN_RANK: Record<Plan, number> = { FREE: 0, PRO: 1 };

export interface FeatureStatus {
  key: string;
  description: string;
  minPlan: Plan;
  available: boolean;
  /** Why the feature is unavailable; undefined when it is available. */
  reason?: string;
}

/** A feature is available when its flag is on and the workspace plan is at least the flag's minimum plan. */
@Injectable()
export class FeaturesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(workspaceId: string): Promise<FeatureStatus[]> {
    const [workspace, flags] = await Promise.all([
      this.prisma.workspace.findUniqueOrThrow({
        where: { id: workspaceId },
        select: { plan: true },
      }),
      this.prisma.featureFlag.findMany({ orderBy: { key: 'asc' } }),
    ]);
    return flags.map((flag) => this.evaluate(flag, workspace.plan));
  }

  async check(workspaceId: string, key: string): Promise<FeatureStatus> {
    const [workspace, flag] = await Promise.all([
      this.prisma.workspace.findUniqueOrThrow({
        where: { id: workspaceId },
        select: { plan: true },
      }),
      this.prisma.featureFlag.findUnique({ where: { key } }),
    ]);
    if (!flag) {
      return {
        key,
        description: key,
        minPlan: Plan.PRO,
        available: false,
        reason: `Unknown feature "${key}"`,
      };
    }
    return this.evaluate(flag, workspace.plan);
  }

  private evaluate(
    flag: { key: string; description: string; minPlan: Plan; enabled: boolean },
    plan: Plan,
  ): FeatureStatus {
    const base = { key: flag.key, description: flag.description, minPlan: flag.minPlan };
    if (!flag.enabled)
      return { ...base, available: false, reason: `"${flag.key}" is switched off` };
    if (PLAN_RANK[plan] < PLAN_RANK[flag.minPlan]) {
      return {
        ...base,
        available: false,
        reason: `"${flag.key}" requires the ${flag.minPlan} plan`,
      };
    }
    return { ...base, available: true };
  }
}
