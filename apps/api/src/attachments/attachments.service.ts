import { BadRequestException, Injectable } from '@nestjs/common';
import { unlink } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { env } from '../env.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  ListAttachmentsQuery,
  UpdateAttachmentDto,
  UploadAttachmentDto,
} from './attachment.dto.js';
import { originalName } from './upload.config.js';

@Injectable()
export class AttachmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(workspaceId: string, { pageId, q, skip, limit }: ListAttachmentsQuery) {
    const where: Prisma.AttachmentWhereInput = {
      workspaceId,
      pageId,
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
      await this.assertPage(workspaceId, dto.pageId);
      return await this.prisma.attachment.create({
        data: {
          workspaceId,
          pageId: dto.pageId,
          filename: originalName(file),
          url: `/uploads/${file.filename}`,
          mimeType: file.mimetype,
          size: file.size,
        },
      });
    } catch (error) {
      await this.deleteFile(file.filename); // do not leave orphans when the record was rejected
      throw error;
    }
  }

  async update(workspaceId: string, id: string, dto: UpdateAttachmentDto) {
    await this.assertPage(workspaceId, dto.pageId);
    return this.prisma.attachment.update({ where: { id, workspaceId }, data: dto });
  }

  async remove(workspaceId: string, id: string) {
    const attachment = await this.get(workspaceId, id);
    await this.prisma.attachment.delete({ where: { id } });
    await this.deleteFile(basename(attachment.url));
  }

  private async assertPage(workspaceId: string, pageId?: string | null) {
    if (!pageId) return;
    const page = await this.prisma.page.findFirst({
      where: { id: pageId, workspaceId },
      select: { id: true },
    });
    if (!page) throw new BadRequestException('pageId does not belong to this workspace');
  }

  private async deleteFile(storedName: string) {
    await unlink(join(env.uploadDir, basename(storedName))).catch(() => undefined);
  }
}
