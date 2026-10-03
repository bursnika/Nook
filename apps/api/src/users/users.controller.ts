import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ApiPaginatedResponse, toPage } from '../common/pagination.js';
import { IdParams } from '../common/params.js';
import { CreateUserDto, ListUsersQuery, UpdateUserDto } from './user.dto.js';
import { UsersService } from './users.service.js';

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @ApiPaginatedResponse()
  async list(@Query() query: ListUsersQuery, @Req() req: Request) {
    const { items, total } = await this.users.list(query);
    return toPage(req, items, total, query);
  }

  @Get(':id')
  get(@Param() { id }: IdParams) {
    return this.users.get(id);
  }

  @Post()
  create(@Body() dto: CreateUserDto) {
    return this.users.create(dto);
  }

  @Patch(':id')
  update(@Param() { id }: IdParams, @Body() dto: UpdateUserDto) {
    return this.users.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param() { id }: IdParams) {
    return this.users.remove(id);
  }
}
