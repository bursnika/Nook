import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

export interface FeatureStatus {
  key: string;
  description: string;
  available: boolean;
  reason?: string;
}

@Injectable()
export class FeaturesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<FeatureStatus[]> {
    const flags = await this.prisma.featureFlag.findMany({ orderBy: { key: 'asc' } });
    return flags.map((flag) => this.evaluate(flag));
  }

  async check(key: string): Promise<FeatureStatus> {
    const flag = await this.prisma.featureFlag.findUnique({ where: { key } });
    if (!flag) {
      return { key, description: key, available: false, reason: `Unknown feature "${key}"` };
    }
    return this.evaluate(flag);
  }

  private evaluate(flag: { key: string; description: string; enabled: boolean }): FeatureStatus {
    const base = { key: flag.key, description: flag.description };
    return flag.enabled
      ? { ...base, available: true }
      : { ...base, available: false, reason: `"${flag.key}" is switched off` };
  }
}
