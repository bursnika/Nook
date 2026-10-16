import { Body, Get, Param, Post, Query, Render, Req, Res } from '@nestjs/common';
import { IsEnum, IsOptional } from 'class-validator';
import type { Request, Response } from 'express';
import { WorkspaceItemParams, WorkspaceParams } from '../common/params.js';
import { TaskPriority, TaskStatus } from '../generated/prisma/enums.js';
import { CreateTaskDto, UpdateTaskDto } from '../tasks/task.dto.js';
import { TasksService } from '../tasks/tasks.service.js';
import { WorkspacesService } from '../workspaces/workspaces.service.js';
import { AdminController } from './admin-controller.decorator.js';
import { AdminListQuery } from './admin-query.js';
import { enumOptions, flashMessage, PAGE_SIZE, pager, parseForm, toFormMessage } from './forms.js';
import { LookupService } from './lookup.service.js';

class TaskListQuery extends AdminListQuery {
  @IsOptional()
  @IsEnum(TaskStatus)
  status?: TaskStatus;
}

@AdminController('admin/workspaces/:workspaceId/tasks')
export class TasksAdminController {
  constructor(
    private readonly tasks: TasksService,
    private readonly workspaces: WorkspacesService,
    private readonly lookup: LookupService,
  ) {}

  @Get()
  @Render('admin/tasks/index')
  async index(
    @Param() { workspaceId }: WorkspaceParams,
    @Query() query: TaskListQuery,
    @Req() req: Request,
  ) {
    const { page, q, flash, status } = query;
    const ws = await this.workspaces.get(workspaceId);
    const { items, total } = await this.tasks.list(workspaceId, {
      q,
      status,
      skip: (page - 1) * PAGE_SIZE,
      limit: PAGE_SIZE,
    });
    return {
      title: 'Tasks',
      section: 'tasks',
      ws,
      flash: flashMessage(flash),
      q,
      statuses: [
        { value: '', label: 'any status', selected: !status },
        ...enumOptions(Object.values(TaskStatus), status),
      ],
      tasks: items,
      pager: pager(req, total, page),
    };
  }

  @Get('new')
  @Render('admin/tasks/form')
  newForm(@Param() { workspaceId }: WorkspaceParams) {
    return this.formView(workspaceId, {
      title: 'New task',
      action: `/admin/workspaces/${workspaceId}/tasks`,
    });
  }

  @Post()
  async create(
    @Param() { workspaceId }: WorkspaceParams,
    @Body() body: Record<string, unknown>,
    @Res() res: Response,
  ) {
    const view = {
      title: 'New task',
      action: `/admin/workspaces/${workspaceId}/tasks`,
      form: body,
    };
    const { value, errors, ok } = await parseForm(CreateTaskDto, body);
    if (!ok)
      return res
        .status(400)
        .render('admin/tasks/form', await this.formView(workspaceId, { ...view, errors }));
    try {
      const created = await this.tasks.create(workspaceId, value);
      return res.redirect(`/admin/workspaces/${workspaceId}/tasks/${created.id}?flash=created`);
    } catch (error) {
      const formError = toFormMessage(error);
      if (!formError) throw error;
      return res
        .status(400)
        .render('admin/tasks/form', await this.formView(workspaceId, { ...view, formError }));
    }
  }

  @Get(':id')
  @Render('admin/tasks/show')
  async show(
    @Param() { workspaceId, id }: WorkspaceItemParams,
    @Query() { flash }: AdminListQuery,
  ) {
    const [ws, task] = await Promise.all([
      this.workspaces.get(workspaceId),
      this.tasks.get(workspaceId, id),
    ]);
    const [assignee, page] = await Promise.all([
      this.lookup.userOption(task.assigneeId),
      this.lookup.pageOption(workspaceId, task.pageId),
    ]);
    return {
      title: task.title,
      section: 'tasks',
      ws,
      flash: flashMessage(flash),
      task,
      assignee: assignee[0],
      page: page[0],
    };
  }

  @Get(':id/edit')
  async editForm(@Param() { workspaceId, id }: WorkspaceItemParams, @Res() res: Response) {
    const task = await this.tasks.get(workspaceId, id);
    const form = task as unknown as Record<string, unknown>;
    return res.render(
      'admin/tasks/form',
      await this.formView(workspaceId, {
        title: `Edit ${task.title}`,
        action: `/admin/workspaces/${workspaceId}/tasks/${id}`,
        form,
      }),
    );
  }

  @Post(':id')
  async update(
    @Param() { workspaceId, id }: WorkspaceItemParams,
    @Body() body: Record<string, unknown>,
    @Res() res: Response,
  ) {
    const task = await this.tasks.get(workspaceId, id);
    const view = {
      title: `Edit ${task.title}`,
      action: `/admin/workspaces/${workspaceId}/tasks/${id}`,
      form: body,
    };
    const { value, errors, ok } = await parseForm(UpdateTaskDto, body, {
      nullable: ['description', 'dueDate', 'pageId', 'assigneeId'],
    });
    if (!ok)
      return res
        .status(400)
        .render('admin/tasks/form', await this.formView(workspaceId, { ...view, errors }));
    try {
      await this.tasks.update(workspaceId, id, value);
      return res.redirect(`/admin/workspaces/${workspaceId}/tasks/${id}?flash=updated`);
    } catch (error) {
      const formError = toFormMessage(error);
      if (!formError) throw error;
      return res
        .status(400)
        .render('admin/tasks/form', await this.formView(workspaceId, { ...view, formError }));
    }
  }

  @Post(':id/delete')
  async remove(@Param() { workspaceId, id }: WorkspaceItemParams, @Res() res: Response) {
    await this.tasks.remove(workspaceId, id);
    return res.redirect(`/admin/workspaces/${workspaceId}/tasks?flash=deleted`);
  }

  private async formView(
    workspaceId: string,
    view: {
      title: string;
      action: string;
      form?: Record<string, unknown>;
      errors?: Record<string, string>;
      formError?: string;
    },
  ) {
    const form = view.form ?? {};
    const [ws, assignees, pages] = await Promise.all([
      this.workspaces.get(workspaceId),
      this.lookup.userOption(form.assigneeId),
      this.lookup.pageOption(workspaceId, form.pageId),
    ]);
    return {
      ...view,
      section: 'tasks',
      ws,
      form,
      errors: view.errors ?? {},
      statuses: enumOptions(Object.values(TaskStatus), (form.status as string) ?? TaskStatus.TODO),
      priorities: enumOptions(
        Object.values(TaskPriority),
        (form.priority as string) ?? TaskPriority.MEDIUM,
      ),
      dueDate: form.dueDate ? new Date(form.dueDate as string).toISOString().slice(0, 10) : '',
      assignees,
      pages,
    };
  }
}
