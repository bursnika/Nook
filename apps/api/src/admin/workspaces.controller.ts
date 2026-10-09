import { Body, Get, Param, Post, Query, Redirect, Render, Req, Res } from '@nestjs/common';
import { IsEnum, IsUUID } from 'class-validator';
import type { Request, Response } from 'express';
import { IdParams } from '../common/params.js';
import { Plan, Role } from '../generated/prisma/enums.js';
import { AddMemberDto, UpdateMemberDto } from '../members/member.dto.js';
import { MembersService } from '../members/members.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateWorkspaceDto, UpdateWorkspaceDto } from '../workspaces/workspace.dto.js';
import { WorkspacesService } from '../workspaces/workspaces.service.js';
import { AdminController } from './admin-controller.decorator.js';
import { AdminListQuery } from './admin-query.js';
import { enumOptions, flashMessage, PAGE_SIZE, pager, parseForm, toFormMessage } from './forms.js';

class MemberParams extends IdParams {
  @IsUUID()
  memberId!: string;
}

class RoleForm extends UpdateMemberDto {
  @IsEnum(Role)
  declare role: Role;
}

@AdminController('admin/workspaces')
export class WorkspacesAdminController {
  constructor(
    private readonly workspaces: WorkspacesService,
    private readonly members: MembersService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @Render('admin/workspaces/index')
  async index(@Query() { page, q, flash }: AdminListQuery, @Req() req: Request) {
    const { items, total } = await this.workspaces.list({
      q,
      skip: (page - 1) * PAGE_SIZE,
      limit: PAGE_SIZE,
    });
    return {
      title: 'Workspaces',
      nav: 'workspaces',
      flash: flashMessage(flash),
      q,
      workspaces: items,
      pager: pager(req, total, page),
    };
  }

  @Get('new')
  @Render('admin/workspaces/form')
  newForm() {
    return this.formView({ title: 'New workspace', action: '/admin/workspaces' });
  }

  @Post()
  async create(@Body() body: Record<string, unknown>, @Res() res: Response) {
    const { value, errors, ok } = await parseForm(CreateWorkspaceDto, body);
    const view = { title: 'New workspace', action: '/admin/workspaces', form: body, errors };
    if (!ok) return res.status(400).render('admin/workspaces/form', this.formView(view));
    try {
      const created = await this.workspaces.create(value);
      return res.redirect(`/admin/workspaces/${created.id}?flash=created`);
    } catch (error) {
      const formError = toFormMessage(error);
      if (!formError) throw error;
      return res.status(400).render('admin/workspaces/form', this.formView({ ...view, formError }));
    }
  }

  @Get(':id')
  @Render('admin/workspaces/show')
  async show(@Param() { id }: IdParams, @Query() { flash }: AdminListQuery) {
    const workspace = await this.prisma.workspace.findUniqueOrThrow({
      where: { id },
      include: { _count: { select: { pages: true, tasks: true, tags: true, attachments: true } } },
    });
    const members = await this.members.list(id);
    return {
      title: workspace.name,
      section: 'overview',
      ws: workspace,
      flash: flashMessage(flash),
      counts: workspace._count,
      members: members.map((m) => ({ ...m, roles: enumOptions(Object.values(Role), m.role) })),
      newRoles: enumOptions(Object.values(Role), Role.MEMBER),
    };
  }

  @Get(':id/edit')
  @Render('admin/workspaces/form')
  async editForm(@Param() { id }: IdParams) {
    const workspace = await this.workspaces.get(id);
    return this.formView({
      title: `Edit ${workspace.name}`,
      action: `/admin/workspaces/${id}`,
      form: workspace,
      ws: workspace,
    });
  }

  @Post(':id')
  async update(
    @Param() { id }: IdParams,
    @Body() body: Record<string, unknown>,
    @Res() res: Response,
  ) {
    const workspace = await this.workspaces.get(id);
    const { value, errors, ok } = await parseForm(UpdateWorkspaceDto, body);
    const view = {
      title: `Edit ${workspace.name}`,
      action: `/admin/workspaces/${id}`,
      form: body,
      errors,
      ws: workspace,
    };
    if (!ok) return res.status(400).render('admin/workspaces/form', this.formView(view));
    try {
      await this.workspaces.update(id, value);
      return res.redirect(`/admin/workspaces/${id}?flash=updated`);
    } catch (error) {
      const formError = toFormMessage(error);
      if (!formError) throw error;
      return res.status(400).render('admin/workspaces/form', this.formView({ ...view, formError }));
    }
  }

  @Post(':id/delete')
  @Redirect('/admin/workspaces?flash=deleted')
  async remove(@Param() { id }: IdParams) {
    await this.workspaces.remove(id);
  }

  // ---- members -------------------------------------------------------------------------------

  @Post(':id/members')
  async addMember(
    @Param() { id }: IdParams,
    @Body() body: Record<string, unknown>,
    @Res() res: Response,
  ) {
    const { value, ok, errors } = await parseForm(AddMemberDto, body);
    if (!ok) {
      return res.status(400).render('admin/error', {
        title: 'Error 400',
        status: 400,
        message: Object.values(errors).join(', '),
      });
    }
    await this.members.add(id, value);
    return res.redirect(`/admin/workspaces/${id}?flash=created`);
  }

  @Post(':id/members/:memberId')
  async changeRole(
    @Param() { id, memberId }: MemberParams,
    @Body() body: Record<string, unknown>,
    @Res() res: Response,
  ) {
    const { value, ok } = await parseForm(RoleForm, body);
    if (ok) await this.members.updateRole(id, memberId, value);
    return res.redirect(`/admin/workspaces/${id}?flash=updated`);
  }

  @Post(':id/members/:memberId/delete')
  async removeMember(@Param() { id, memberId }: MemberParams, @Res() res: Response) {
    await this.members.remove(id, memberId);
    return res.redirect(`/admin/workspaces/${id}?flash=deleted`);
  }

  private formView(view: {
    title: string;
    action: string;
    form?: Record<string, unknown>;
    errors?: Record<string, string>;
    formError?: string;
    ws?: { id: string; name: string };
  }) {
    const plan = (view.form?.plan as string | undefined) ?? Plan.FREE;
    return {
      ...view,
      nav: 'workspaces',
      section: 'overview',
      form: view.form ?? {},
      errors: view.errors ?? {},
      plans: enumOptions(Object.values(Plan), plan),
    };
  }
}
