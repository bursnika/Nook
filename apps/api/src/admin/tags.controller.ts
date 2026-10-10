import { Body, Get, Param, Post, Query, Render, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { WorkspaceItemParams, WorkspaceParams } from '../common/params.js';
import { CreateTagDto, UpdateTagDto } from '../tags/tag.dto.js';
import { TagsService } from '../tags/tags.service.js';
import { WorkspacesService } from '../workspaces/workspaces.service.js';
import { AdminController } from './admin-controller.decorator.js';
import { AdminListQuery } from './admin-query.js';
import { flashMessage, PAGE_SIZE, pager, parseForm, toFormMessage } from './forms.js';

@AdminController('admin/workspaces/:workspaceId/tags')
export class TagsAdminController {
  constructor(
    private readonly tags: TagsService,
    private readonly workspaces: WorkspacesService,
  ) {}

  @Get()
  @Render('admin/tags/index')
  async index(
    @Param() { workspaceId }: WorkspaceParams,
    @Query() { page, q, flash }: AdminListQuery,
    @Req() req: Request,
  ) {
    const ws = await this.workspaces.get(workspaceId);
    const { items, total } = await this.tags.list(workspaceId, {
      q,
      skip: (page - 1) * PAGE_SIZE,
      limit: PAGE_SIZE,
    });
    return {
      title: 'Tags',
      section: 'tags',
      ws,
      flash: flashMessage(flash),
      q,
      tags: items,
      pager: pager(req, total, page),
    };
  }

  @Get('new')
  @Render('admin/tags/form')
  newForm(@Param() { workspaceId }: WorkspaceParams) {
    return this.formView(workspaceId, {
      title: 'New tag',
      action: `/admin/workspaces/${workspaceId}/tags`,
      form: { color: '#EC4E95' },
    });
  }

  @Post()
  async create(
    @Param() { workspaceId }: WorkspaceParams,
    @Body() body: Record<string, unknown>,
    @Res() res: Response,
  ) {
    const view = { title: 'New tag', action: `/admin/workspaces/${workspaceId}/tags`, form: body };
    const { value, errors, ok } = await parseForm(CreateTagDto, body);
    if (!ok)
      return res
        .status(400)
        .render('admin/tags/form', await this.formView(workspaceId, { ...view, errors }));
    try {
      await this.tags.create(workspaceId, value);
      return res.redirect(`/admin/workspaces/${workspaceId}/tags?flash=created`);
    } catch (error) {
      const formError = toFormMessage(error);
      if (!formError) throw error;
      return res
        .status(400)
        .render('admin/tags/form', await this.formView(workspaceId, { ...view, formError }));
    }
  }

  @Get(':id/edit')
  async editForm(@Param() { workspaceId, id }: WorkspaceItemParams, @Res() res: Response) {
    const tag = await this.tags.get(workspaceId, id);
    return res.render(
      'admin/tags/form',
      await this.formView(workspaceId, {
        title: `Edit ${tag.name}`,
        action: `/admin/workspaces/${workspaceId}/tags/${id}`,
        form: tag as unknown as Record<string, unknown>,
      }),
    );
  }

  @Post(':id')
  async update(
    @Param() { workspaceId, id }: WorkspaceItemParams,
    @Body() body: Record<string, unknown>,
    @Res() res: Response,
  ) {
    const tag = await this.tags.get(workspaceId, id);
    const view = {
      title: `Edit ${tag.name}`,
      action: `/admin/workspaces/${workspaceId}/tags/${id}`,
      form: body,
    };
    const { value, errors, ok } = await parseForm(UpdateTagDto, body);
    if (!ok)
      return res
        .status(400)
        .render('admin/tags/form', await this.formView(workspaceId, { ...view, errors }));
    try {
      await this.tags.update(workspaceId, id, value);
      return res.redirect(`/admin/workspaces/${workspaceId}/tags?flash=updated`);
    } catch (error) {
      const formError = toFormMessage(error);
      if (!formError) throw error;
      return res
        .status(400)
        .render('admin/tags/form', await this.formView(workspaceId, { ...view, formError }));
    }
  }

  @Post(':id/delete')
  async remove(@Param() { workspaceId, id }: WorkspaceItemParams, @Res() res: Response) {
    await this.tags.remove(workspaceId, id);
    return res.redirect(`/admin/workspaces/${workspaceId}/tags?flash=deleted`);
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
    return {
      ...view,
      section: 'tags',
      ws: await this.workspaces.get(workspaceId),
      form: view.form ?? {},
      errors: view.errors ?? {},
    };
  }
}
