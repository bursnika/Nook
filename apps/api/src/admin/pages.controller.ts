import {
  Body,
  Get,
  Param,
  Post,
  Query,
  Render,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators.js';
import { uploadOptions } from '../attachments/upload.config.js';
import { WorkspaceItemParams, WorkspaceParams } from '../common/params.js';
import { CreatePageDto, UpdatePageDto } from '../pages/page.dto.js';
import { PagesService } from '../pages/pages.service.js';
import type { ListTasksQuery } from '../tasks/task.dto.js';
import { TasksService } from '../tasks/tasks.service.js';
import { UploadsService } from '../uploads/uploads.service.js';
import { WorkspacesService } from '../workspaces/workspaces.service.js';
import { AdminController } from './admin-controller.decorator.js';
import { AdminListQuery } from './admin-query.js';
import { flashMessage, PAGE_SIZE, pager, parseForm, toFormMessage } from './forms.js';
import { LookupService } from './lookup.service.js';

const IMAGE = /^image\/(png|jpeg|gif|webp)$/;

@AdminController('admin/workspaces/:workspaceId/pages')
export class PagesAdminController {
  constructor(
    private readonly pages: PagesService,
    private readonly workspaces: WorkspacesService,
    private readonly lookup: LookupService,
    private readonly uploads: UploadsService,
    private readonly tasks: TasksService,
  ) {}

  @Get()
  @Render('admin/pages/index')
  async index(
    @Param() { workspaceId }: WorkspaceParams,
    @Query() { page, q, flash }: AdminListQuery,
    @Req() req: Request,
  ) {
    const ws = await this.workspaces.get(workspaceId);
    const { items, total } = await this.pages.list(workspaceId, {
      q,
      skip: (page - 1) * PAGE_SIZE,
      limit: PAGE_SIZE,
    });
    return {
      title: 'Pages',
      section: 'pages',
      ws,
      flash: flashMessage(flash),
      q,
      pages: items,
      pager: pager(req, total, page),
    };
  }

  @Get('new')
  @Render('admin/pages/form')
  async newForm(@Param() { workspaceId }: WorkspaceParams) {
    return this.formView(workspaceId, {
      title: 'New page',
      action: `/admin/workspaces/${workspaceId}/pages`,
      isNew: true,
    });
  }

  @Post()
  @UseInterceptors(FileInterceptor('cover', uploadOptions))
  async create(
    @Param() { workspaceId }: WorkspaceParams,
    @Body() body: Record<string, unknown>,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ) {
    const view = {
      title: 'New page',
      action: `/admin/workspaces/${workspaceId}/pages`,
      isNew: true,
      form: body,
    };
    const { value, errors, ok } = await parseForm(CreatePageDto, body, {
      booleans: ['isPublished'],
    });
    const coverError = await this.rejectBadCover(file);
    if (!ok || coverError) {
      return res.status(400).render(
        'admin/pages/form',
        await this.formView(workspaceId, {
          ...view,
          errors: { ...errors, ...(coverError && { cover: coverError }) },
        }),
      );
    }
    if (file) value.coverUrl = this.uploads.urlFor(file.filename);
    try {
      const created = await this.pages.create(workspaceId, value, user.id);
      return res.redirect(`/admin/workspaces/${workspaceId}/pages/${created.id}?flash=created`);
    } catch (error) {
      await this.uploads.remove(file?.filename);
      const formError = toFormMessage(error);
      if (!formError) throw error;
      return res
        .status(400)
        .render('admin/pages/form', await this.formView(workspaceId, { ...view, formError }));
    }
  }

  @Get(':id')
  @Render('admin/pages/show')
  async show(
    @Param() { workspaceId, id }: WorkspaceItemParams,
    @Query() { flash }: AdminListQuery,
  ) {
    const [ws, page, linked] = await Promise.all([
      this.workspaces.get(workspaceId),
      this.pages.get(workspaceId, id),
      this.tasks.list(workspaceId, { pageId: id, skip: 0, limit: 100 } as ListTasksQuery),
    ]);
    const now = new Date();
    const open = linked.items.filter((task) => task.status !== 'DONE');
    const tasks = [...open, ...linked.items.filter((task) => task.status === 'DONE')].map(
      (task) => ({
        ...task,
        isOverdue: task.status !== 'DONE' && !!task.dueDate && task.dueDate < now,
      }),
    );
    return {
      title: page.title,
      section: 'pages',
      ws,
      flash: flashMessage(flash),
      page,
      tasks,
      tasksTotal: linked.total,
    };
  }

  @Get(':id/edit')
  @Render('admin/pages/form')
  async editForm(@Param() { workspaceId, id }: WorkspaceItemParams) {
    const page = await this.pages.get(workspaceId, id);
    return this.formView(workspaceId, {
      title: `Edit ${page.title}`,
      action: `/admin/workspaces/${workspaceId}/pages/${id}`,
      form: page as unknown as Record<string, unknown>,
      current: page,
    });
  }

  @Post(':id')
  @UseInterceptors(FileInterceptor('cover', uploadOptions))
  async update(
    @Param() { workspaceId, id }: WorkspaceItemParams,
    @Body() body: Record<string, unknown>,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Res() res: Response,
  ) {
    const current = await this.pages.get(workspaceId, id);
    const view = {
      title: `Edit ${current.title}`,
      action: `/admin/workspaces/${workspaceId}/pages/${id}`,
      form: { ...body, coverUrl: current.coverUrl },
      current,
    };
    const { value, errors, ok } = await parseForm(UpdatePageDto, body, {
      nullable: ['parentId', 'icon', 'slug'],
      booleans: ['isPublished'],
    });
    const coverError = await this.rejectBadCover(file);
    if (!ok || coverError) {
      return res.status(400).render(
        'admin/pages/form',
        await this.formView(workspaceId, {
          ...view,
          errors: { ...errors, ...(coverError && { cover: coverError }) },
        }),
      );
    }

    const removing = body.removeCover === 'on';
    if (file) value.coverUrl = this.uploads.urlFor(file.filename);
    else if (removing) (value as { coverUrl: string | null }).coverUrl = null;

    try {
      await this.pages.update(workspaceId, id, value);
    } catch (error) {
      await this.uploads.remove(file?.filename);
      const formError = toFormMessage(error);
      if (!formError) throw error;
      return res
        .status(400)
        .render('admin/pages/form', await this.formView(workspaceId, { ...view, formError }));
    }
    if (file || removing) await this.uploads.remove(current.coverUrl); // the old cover is no longer referenced
    return res.redirect(`/admin/workspaces/${workspaceId}/pages/${id}?flash=updated`);
  }

  @Post(':id/delete')
  async remove(@Param() { workspaceId, id }: WorkspaceItemParams, @Res() res: Response) {
    const page = await this.pages.get(workspaceId, id);
    await this.pages.remove(workspaceId, id);
    await this.uploads.remove(page.coverUrl);
    return res.redirect(`/admin/workspaces/${workspaceId}/pages?flash=deleted`);
  }

  /** The cover must be an image; anything else is deleted again and reported on the form. */
  private async rejectBadCover(file?: Express.Multer.File) {
    if (!file || IMAGE.test(file.mimetype)) return null;
    await this.uploads.remove(file.filename);
    return 'The cover must be a PNG, JPEG, GIF or WebP image.';
  }

  private async formView(
    workspaceId: string,
    view: {
      title: string;
      action: string;
      isNew?: boolean;
      form?: Record<string, unknown>;
      errors?: Record<string, string>;
      formError?: string;
      current?: { coverUrl: string | null; parent: { id: string; title: string } | null };
    },
  ) {
    const form = view.form ?? {};
    const [ws, parents] = await Promise.all([
      this.workspaces.get(workspaceId),
      this.lookup.pageOption(workspaceId, form.parentId),
    ]);
    return {
      ...view,
      section: 'pages',
      ws,
      form,
      errors: view.errors ?? {},
      parents,
      coverUrl: view.current?.coverUrl ?? null,
    };
  }
}
