import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TasksService } from '../tasks/tasks.service.js';
import { UploadsService } from '../uploads/uploads.service.js';
import {
  ListAttachmentsQuery,
  UpdateAttachmentDto,
  UploadAttachmentDto,
} from './attachment.dto.js';
import { originalName } from './upload.config.js';

@Injectable()
export class AttachmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: UploadsService,
    private readonly tasks: TasksService,
  ) {}

  async list(workspaceId: string, { pageId, taskId, q, skip, limit }: ListAttachmentsQuery) {
    const where: Prisma.AttachmentWhereInput = {
      workspaceId,
      pageId,
      taskId,
      ...(q ? { filename: { contains: q, mode: 'insensitive' } } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.attachment.findMany({ where, skip, take: limit, orderBy: { id: 'desc' } }),
      this.prisma.attachment.count({ where }),
    ]);
    return { items, total };
  }

  get(workspaceId: string, id: string) {
    return this.prisma.attachment.findFirstOrThrow({ where: { id, workspaceId } });
  }

  async create(
    workspaceId: string,
    file: Express.Multer.File | undefined,
    dto: UploadAttachmentDto,
  ) {
    if (!file) throw new BadRequestException('Send the file in a multipart field named "file"');
    try {
      await this.prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
      await this.assertRefs(workspaceId, dto);
      const attachment = await this.prisma.attachment.create({
        data: {
          workspaceId,
          pageId: dto.pageId,
          taskId: dto.taskId,
          filename: originalName(file),
          url: this.uploads.urlFor(file.filename),
          mimeType: file.mimetype,
          size: file.size,
        },
      });
      if (attachment.taskId) await this.tasks.touch(workspaceId, attachment.taskId);
      return attachment;
    } catch (error) {
      await this.uploads.remove(file.filename); // do not leave orphans when the record was rejected
      throw error;
    }
  }

  /** For callers that reject an upload before creating a record (e.g. form validation failed). */
  async discardUpload(file: Express.Multer.File) {
    await this.uploads.remove(file.filename);
  }

  async update(workspaceId: string, id: string, dto: UpdateAttachmentDto) {
    await this.assertRefs(workspaceId, dto);
    const before = await this.get(workspaceId, id);
    const attachment = await this.prisma.attachment.update({
      where: { id, workspaceId },
      data: dto,
    });
    await this.touchTasks(workspaceId, before.taskId, attachment.taskId);
    return attachment;
  }

  async remove(workspaceId: string, id: string) {
    const attachment = await this.get(workspaceId, id);
    await this.prisma.attachment.delete({ where: { id } });
    await this.uploads.remove(attachment.url);
    await this.touchTasks(workspaceId, attachment.taskId);
  }

  /** A file may only point at a page or a task of its own workspace. */
  private async assertRefs(
    workspaceId: string,
    { pageId, taskId }: { pageId?: string | null; taskId?: string | null },
  ) {
    if (pageId) {
      const page = await this.prisma.page.findFirst({
        where: { id: pageId, workspaceId },
        select: { id: true },
      });
      if (!page) throw new BadRequestException('pageId does not belong to this workspace');
    }
    if (taskId) {
      const task = await this.prisma.task.findFirst({
        where: { id: taskId, workspaceId },
        select: { id: true },
      });
      if (!task) throw new BadRequestException('taskId does not belong to this workspace');
    }
  }

  /** The file count on a task card changed. */
  private async touchTasks(workspaceId: string, ...taskIds: (string | null)[]) {
    const ids = new Set(taskIds.filter((taskId): taskId is string => !!taskId));
    for (const taskId of ids) await this.tasks.touch(workspaceId, taskId);
  }
}
