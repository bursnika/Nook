import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { Role } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TasksService } from './tasks.service.js';

const AUTHOR = { author: { select: { id: true, name: true, avatarUrl: true } } } as const;

/** Comments and notes under a task, oldest first like a conversation. */
@Injectable()
export class TaskCommentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tasks: TasksService,
  ) {}

  async list(workspaceId: string, taskId: string) {
    await this.tasks.get(workspaceId, taskId);
    return this.prisma.taskComment.findMany({
      where: { taskId },
      include: AUTHOR,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  async create(workspaceId: string, taskId: string, authorId: string, body: string) {
    await this.tasks.get(workspaceId, taskId);
    const comment = await this.prisma.taskComment.create({
      data: { taskId, authorId, body: this.clean(body) },
      include: AUTHOR,
    });
    await this.tasks.touch(workspaceId, taskId);
    return comment;
  }

  /** Only the author may reword a comment. */
  async update(workspaceId: string, taskId: string, id: string, userId: string, body: string) {
    const comment = await this.find(workspaceId, taskId, id);
    if (comment.authorId !== userId) throw new ForbiddenException('Only the author can edit it');
    return this.prisma.taskComment.update({
      where: { id },
      data: { body: this.clean(body) },
      include: AUTHOR,
    });
  }

  /** The author, or an owner or admin of the workspace, may delete a comment. */
  async remove(
    workspaceId: string,
    taskId: string,
    id: string,
    actor: { userId: string; role?: Role },
  ) {
    const comment = await this.find(workspaceId, taskId, id);
    const moderator = actor.role === Role.OWNER || actor.role === Role.ADMIN;
    if (comment.authorId !== actor.userId && !moderator) {
      throw new ForbiddenException('Only the author or a workspace admin can delete it');
    }
    await this.prisma.taskComment.delete({ where: { id } });
    await this.tasks.touch(workspaceId, taskId);
  }

  private find(workspaceId: string, taskId: string, id: string) {
    return this.prisma.taskComment.findFirstOrThrow({
      where: { id, taskId, task: { workspaceId } },
    });
  }

  private clean(body: string) {
    const text = body.trim();
    if (!text) throw new BadRequestException('body must not be empty');
    return text;
  }
}
