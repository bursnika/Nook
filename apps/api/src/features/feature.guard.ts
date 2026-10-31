import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { REQUIRED_FEATURE } from '../auth/decorators.js';
import { FeaturesService } from './features.service.js';

/** Blocks routes marked @RequireFeature('key') when its flag is switched off. */
@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly features: FeaturesService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const key = this.reflector.getAllAndOverride<string | undefined>(REQUIRED_FEATURE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!key) return true;

    const workspaceId = context.switchToHttp().getRequest<Request>().params?.workspaceId;
    if (typeof workspaceId !== 'string')
      throw new BadRequestException('A feature-gated route needs a :workspaceId');

    const status = await this.features.check(key);
    if (!status.available) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        code: 'FEATURE_NOT_AVAILABLE',
        message: status.reason,
        feature: key,
      });
    }
    return true;
  }
}
