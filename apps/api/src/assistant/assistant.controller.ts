import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Post,
  Res,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser, RequireFeature } from '../auth/decorators.js';
import { WorkspaceParams } from '../common/params.js';
import { WorkspacesService } from '../workspaces/workspaces.service.js';
import { ChatDto } from './assistant.dto.js';
import { AssistantService } from './assistant.service.js';
import { formatSse, formatSseComment } from './sse.js';
import { ASSISTANT_RATE_LIMITER, type SlidingWindowRateLimiter } from './rate-limiter.js';

export const HEARTBEAT_MS = 15_000;

@ApiTags('assistant')
@Controller('workspaces/:workspaceId/assistant')
export class AssistantController {
  constructor(
    private readonly assistant: AssistantService,
    private readonly workspaces: WorkspacesService,
    @Inject(ASSISTANT_RATE_LIMITER) private readonly limiter: SlidingWindowRateLimiter,
  ) {}

  /**
   * One answer as a server-sent event stream (POST, so the browser reads it with fetch, not EventSource).
   * Membership (404) and the Pro feature (403) are checked by the global guards before this runs.
   */
  @Post('chat')
  @HttpCode(200)
  @RequireFeature('ai-assistant')
  async chat(
    @CurrentUser() user: AuthUser,
    @Param() { workspaceId }: WorkspaceParams,
    @Body() { messages }: ChatDto,
    @Res() res: Response,
  ) {
    // everything that can fail with a normal HTTP status happens before the stream starts
    if (!this.assistant.configured) {
      throw new ServiceUnavailableException(
        'The AI assistant is not configured on this server (ANTHROPIC_API_KEY is missing)',
      );
    }
    if (messages[0].role !== 'user' || messages[messages.length - 1].role !== 'user') {
      throw new BadRequestException('The conversation must start and end with a user message');
    }
    const limit = this.limiter.tryAcquire(user.id);
    if (!limit.allowed) {
      res.setHeader('Retry-After', String(limit.retryAfterSeconds));
      throw new HttpException(
        `Too many assistant requests. Try again in ${limit.retryAfterSeconds} s`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const workspace = await this.workspaces.get(workspaceId);

    res.status(HttpStatus.OK);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    // tell nginx-style proxies not to buffer: tokens must reach the browser as they are produced
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const write = (chunk: string) => {
      if (!res.writableEnded && !res.destroyed) res.write(chunk);
    };
    const aborter = new AbortController();
    // `close` also fires after a normal end; only an early one means the client left
    res.on('close', () => {
      if (!res.writableFinished) aborter.abort();
    });
    const heartbeat = setInterval(() => write(formatSseComment('keep-alive')), HEARTBEAT_MS);
    heartbeat.unref();

    try {
      await this.assistant.run({
        workspaceId,
        workspaceName: workspace.name,
        messages,
        signal: aborter.signal,
        emit: (event) => write(formatSse(event)),
      });
    } finally {
      clearInterval(heartbeat);
      if (!res.writableEnded) res.end();
    }
  }
}
