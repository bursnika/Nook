import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Req,
  Body,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request } from 'express';
import { graphql } from 'graphql';
import { GraphqlService, type GraphqlContext } from './graphql.service.js';
import { schema } from './schema.js';

interface GraphqlBody {
  query?: unknown;
  variables?: unknown;
  operationName?: unknown;
}

/** Queries and mutations over HTTP at /graphql. Subscriptions use the WebSocket on the same path. */
@ApiExcludeController()
@Controller('graphql')
export class GraphqlController {
  constructor(private readonly graphqlService: GraphqlService) {}

  @Post()
  @HttpCode(200)
  post(@Body() body: GraphqlBody, @Req() req: Request) {
    return this.run(body, req);
  }

  /** Queries only: a GET must never change anything. */
  @Get()
  get(@Query() query: GraphqlBody, @Req() req: Request) {
    return this.run(query, req, true);
  }

  private async run(
    { query, variables, operationName }: GraphqlBody,
    req: Request,
    readOnly = false,
  ) {
    if (typeof query !== 'string' || !query.trim()) {
      throw new BadRequestException('Send a GraphQL query in "query"');
    }
    if (readOnly && /^\s*mutation\b/m.test(query)) {
      throw new BadRequestException('Mutations must be sent with POST');
    }
    const parsed =
      typeof variables === 'string' && variables ? (JSON.parse(variables) as unknown) : variables;
    const context: GraphqlContext = { user: req.user! };
    // errors of a GraphQL operation travel in the body with status 200, as the protocol says
    return graphql({
      schema,
      source: query,
      rootValue: this.graphqlService.root,
      contextValue: context,
      variableValues: (parsed ?? undefined) as Record<string, unknown> | undefined,
      operationName: typeof operationName === 'string' ? operationName : undefined,
    });
  }
}
