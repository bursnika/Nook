import { applyDecorators, Type as ClassType } from '@nestjs/common';
import { ApiExtraModels, ApiOkResponse, ApiPropertyOptional, getSchemaPath } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';
import type { Request } from 'express';

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

export class PaginationQuery {
  @ApiPropertyOptional({ minimum: 0, default: 0, description: 'Number of items to skip' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip: number = 0;

  @ApiPropertyOptional({ minimum: 1, maximum: MAX_LIMIT, default: DEFAULT_LIMIT })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_LIMIT)
  limit: number = DEFAULT_LIMIT;
}

export class PageResult<T> {
  items!: T[];
  total!: number;
  skip!: number;
  limit!: number;
  nextLink!: string | null;
}

/**
 * Wraps a slice of a collection into the `{ items, total, skip, limit, nextLink }` envelope.
 * `nextLink` keeps every query parameter of the current request (filters, search) and only moves `skip`.
 */
export function toPage<T>(
  req: Request,
  items: T[],
  total: number,
  { skip, limit }: PaginationQuery,
): PageResult<T> {
  let nextLink: string | null = null;
  if (skip + items.length < total) {
    const url = new URL(req.originalUrl, `${req.protocol}://${req.get('host')}`);
    url.searchParams.set('skip', String(skip + limit));
    url.searchParams.set('limit', String(limit));
    nextLink = url.toString();
  }
  return { items, total, skip, limit, nextLink };
}

/** Swagger helper: documents a paginated list of `model`. */
export function ApiPaginatedResponse(model?: ClassType<unknown>) {
  return applyDecorators(
    ...(model ? [ApiExtraModels(model)] : []),
    ApiOkResponse({
      schema: {
        type: 'object',
        required: ['items', 'total', 'skip', 'limit', 'nextLink'],
        properties: {
          items: {
            type: 'array',
            items: model ? { $ref: getSchemaPath(model) } : { type: 'object' },
          },
          total: { type: 'integer' },
          skip: { type: 'integer' },
          limit: { type: 'integer' },
          nextLink: { type: 'string', nullable: true },
        },
      },
    }),
  );
}
