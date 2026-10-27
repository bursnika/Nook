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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ApiPaginatedResponse, toPage } from '../common/pagination.js';
import { WorkspaceItemParams, WorkspaceParams } from '../common/params.js';
import {
  ListAttachmentsQuery,
  UpdateAttachmentDto,
  UploadAttachmentDto,
} from './attachment.dto.js';
import { AttachmentsService } from './attachments.service.js';
import { uploadOptions } from './upload.config.js';

@ApiTags('attachments')
@Controller('workspaces/:workspaceId/attachments')
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  @Get()
  @ApiPaginatedResponse()
  async list(
    @Param() { workspaceId }: WorkspaceParams,
    @Query() query: ListAttachmentsQuery,
    @Req() req: Request,
  ) {
    const { items, total } = await this.attachments.list(workspaceId, query);
    return toPage(req, items, total, query);
  }

  @Get(':id')
  get(@Param() { workspaceId, id }: WorkspaceItemParams) {
    return this.attachments.get(workspaceId, id);
  }

  @Post()
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary' },
        pageId: { type: 'string', format: 'uuid' },
        taskId: { type: 'string', format: 'uuid' },
      },
    },
  })
  @UseInterceptors(FileInterceptor('file', uploadOptions))
  create(
    @Param() { workspaceId }: WorkspaceParams,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: UploadAttachmentDto,
  ) {
    return this.attachments.create(workspaceId, file, dto);
  }

  @Patch(':id')
  update(@Param() { workspaceId, id }: WorkspaceItemParams, @Body() dto: UpdateAttachmentDto) {
    return this.attachments.update(workspaceId, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param() { workspaceId, id }: WorkspaceItemParams) {
    return this.attachments.remove(workspaceId, id);
  }
}
