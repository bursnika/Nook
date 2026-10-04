import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
import { WorkspaceParams } from '../common/params.js';
import { CreateBlockDto, UpdateBlockDto } from './block.dto.js';
import { BlocksService } from './blocks.service.js';

class PageParams extends WorkspaceParams {
  @IsUUID()
  pageId!: string;
}

class BlockParams extends PageParams {
  @IsUUID()
  id!: string;
}

@ApiTags('blocks')
@Controller('workspaces/:workspaceId/pages/:pageId/blocks')
export class BlocksController {
  constructor(private readonly blocks: BlocksService) {}

  @Get()
  list(@Param() { workspaceId, pageId }: PageParams) {
    return this.blocks.list(workspaceId, pageId);
  }

  @Post()
  create(@Param() { workspaceId, pageId }: PageParams, @Body() dto: CreateBlockDto) {
    return this.blocks.create(workspaceId, pageId, dto);
  }

  @Patch(':id')
  update(@Param() { workspaceId, pageId, id }: BlockParams, @Body() dto: UpdateBlockDto) {
    return this.blocks.update(workspaceId, pageId, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param() { workspaceId, pageId, id }: BlockParams) {
    return this.blocks.remove(workspaceId, pageId, id);
  }
}
