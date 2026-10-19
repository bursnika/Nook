import { Body, Get, Param, Post, Query, Render, Req, Res } from '@nestjs/common';
import { IsEnum, IsUUID } from 'class-validator';
import type { Request, Response } from 'express';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser, PlatformAdminOnly, Roles } from '../auth/decorators.js';
import { WorkspaceParams } from '../common/params.js';
import { Plan, Role } from '../generated/prisma/enums.js';
import { CreateInvitationDto } from '../invitations/invitation.dto.js';
import { InvitationsService } from '../invitations/invitations.service.js';
import { AddMemberDto, UpdateMemberDto } from '../members/member.dto.js';
import { GoogleCalendarService } from '../google-calendar/google-calendar.service.js';
import { MembersService } from '../members/members.service.js';
import { OverviewService } from '../overview/overview.service.js';
import { CreateWorkspaceDto, UpdateWorkspaceDto } from '../workspaces/workspace.dto.js';
import { WorkspacesService } from '../workspaces/workspaces.service.js';
import { AdminController } from './admin-controller.decorator.js';
import { AdminListQuery } from './admin-query.js';
import {
  enumOptions,
  flashMessage,
  PAGE_SIZE,
  pager,
  parseForm,
  problemMessage,
  syncMessage,
  toFormMessage,
} from './forms.js';

class MemberParams extends WorkspaceParams {
  @IsUUID()
  memberId!: string;
}

class InvitationParams extends WorkspaceParams {
  @IsUUID()
  invitationId!: string;
}

class RoleForm extends UpdateMemberDto {
  @IsEnum(Role)
  declare role: Role;
}

class PlanForm {
  @IsEnum(Plan)
  plan!: Plan;
}

@AdminController('admin/workspaces')
export class WorkspacesAdminController {
  constructor(
    private readonly workspaces: WorkspacesService,
    private readonly members: MembersService,
    private readonly invitations: InvitationsService,
    private readonly overview: OverviewService,
    private readonly googleCalendar: GoogleCalendarService,
  ) {}

  @Get()
  @Render('admin/workspaces/index')
  async index(
    @Query() { page, q, flash }: AdminListQuery,
    @Req() req: Request,
    @CurrentUser() user: AuthUser,
  ) {
    const { items, total } = await this.workspaces.list(
      { q, skip: (page - 1) * PAGE_SIZE, limit: PAGE_SIZE },
      user,
    );
    return {
      title: 'Workspaces',
      nav: 'workspaces',
      flash: flashMessage(flash),
      q,
      workspaces: items.map(({ memberships, ...workspace }) => ({
        ...workspace,
        myRole: user.isPlatformAdmin ? Role.OWNER : memberships[0]?.role,
      })),
      pager: pager(req, total, page),
    };
  }

  @Get('new')
  @Render('admin/workspaces/form')
  newForm() {
    return this.formView({ title: 'New workspace', action: '/admin/workspaces' });
  }

  @Post()
  async create(
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ) {
    const { value, errors, ok } = await parseForm(CreateWorkspaceDto, body);
    const view = { title: 'New workspace', action: '/admin/workspaces', form: body, errors };
    if (!ok) return res.status(400).render('admin/workspaces/form', this.formView(view));
    try {
      const created = await this.workspaces.create(value, user.id);
      return res.redirect(`/admin/workspaces/${created.id}?flash=created`);
    } catch (error) {
      const formError = toFormMessage(error);
      if (!formError) throw error;
      return res.status(400).render('admin/workspaces/form', this.formView({ ...view, formError }));
    }
  }

  @Get(':workspaceId')
  @Render('admin/workspaces/show')
  async show(
    @Param() { workspaceId }: WorkspaceParams,
    @Query() { flash, problem, events, tasks, tasksNote }: AdminListQuery,
    @CurrentUser() user: AuthUser,
  ) {
    return this.homeView(workspaceId, user.id, {
      flash: flash === 'synced' ? syncMessage({ events, tasks, tasksNote }) : flashMessage(flash),
      formError: problemMessage(problem),
    });
  }

  /** Members, invitations and the plan: the part of a workspace people rarely need. */
  @Get(':workspaceId/team')
  @Render('admin/workspaces/team')
  async team(
    @Param() { workspaceId }: WorkspaceParams,
    @Query() { flash }: AdminListQuery,
    @Req() req: Request,
  ) {
    return this.teamView(workspaceId, req, { flash: flashMessage(flash) });
  }

  @Get(':workspaceId/edit')
  @Roles(Role.OWNER, Role.ADMIN)
  @Render('admin/workspaces/form')
  async editForm(@Param() { workspaceId }: WorkspaceParams) {
    const workspace = await this.workspaces.get(workspaceId);
    return this.formView({
      title: `Edit ${workspace.name}`,
      action: `/admin/workspaces/${workspaceId}`,
      form: workspace,
      ws: workspace,
    });
  }

  @Post(':workspaceId')
  @Roles(Role.OWNER, Role.ADMIN)
  async update(
    @Param() { workspaceId }: WorkspaceParams,
    @Body() body: Record<string, unknown>,
    @Res() res: Response,
  ) {
    const workspace = await this.workspaces.get(workspaceId);
    const { value, errors, ok } = await parseForm(UpdateWorkspaceDto, body);
    const view = {
      title: `Edit ${workspace.name}`,
      action: `/admin/workspaces/${workspaceId}`,
      form: body,
      errors,
      ws: workspace,
    };
    if (!ok) return res.status(400).render('admin/workspaces/form', this.formView(view));
    try {
      await this.workspaces.update(workspaceId, value);
      return res.redirect(`/admin/workspaces/${workspaceId}?flash=updated`);
    } catch (error) {
      const formError = toFormMessage(error);
      if (!formError) throw error;
      return res.status(400).render('admin/workspaces/form', this.formView({ ...view, formError }));
    }
  }

  @Post(':workspaceId/delete')
  @Roles(Role.OWNER)
  async remove(@Param() { workspaceId }: WorkspaceParams, @Res() res: Response) {
    await this.workspaces.remove(workspaceId);
    return res.redirect('/admin/workspaces?flash=deleted');
  }

  @Post(':workspaceId/plan')
  @Roles(Role.OWNER)
  async changePlan(
    @Param() { workspaceId }: WorkspaceParams,
    @Body() body: Record<string, unknown>,
    @Res() res: Response,
  ) {
    const { value, ok } = await parseForm(PlanForm, body);
    if (ok) await this.workspaces.setPlan(workspaceId, value.plan);
    return res.redirect(`/admin/workspaces/${workspaceId}/team?flash=updated`);
  }

  // ---- members -------------------------------------------------------------------------------

  /** Support tool: add any existing user by id. Everyone else invites people by e-mail. */
  @Post(':workspaceId/members')
  @PlatformAdminOnly()
  async addMember(
    @Param() { workspaceId }: WorkspaceParams,
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
    await this.members.add(workspaceId, value);
    return res.redirect(`/admin/workspaces/${workspaceId}/team?flash=created`);
  }

  @Post(':workspaceId/members/:memberId')
  @Roles(Role.OWNER)
  async changeRole(
    @Param() { workspaceId, memberId }: MemberParams,
    @Body() body: Record<string, unknown>,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const { value, ok } = await parseForm(RoleForm, body);
    if (ok) {
      await this.members.updateRole(workspaceId, memberId, value, {
        userId: req.user!.id,
        role: req.membership!.role,
      });
    }
    return res.redirect(`/admin/workspaces/${workspaceId}/team?flash=updated`);
  }

  @Post(':workspaceId/members/:memberId/delete')
  @Roles(Role.OWNER, Role.ADMIN)
  async removeMember(
    @Param() { workspaceId, memberId }: MemberParams,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    await this.members.remove(workspaceId, memberId, req.membership!.role);
    return res.redirect(`/admin/workspaces/${workspaceId}/team?flash=deleted`);
  }

  // ---- invitations ---------------------------------------------------------------------------

  /** Shows the invite link once, on the response itself, so the secret never travels through a URL. */
  @Post(':workspaceId/invitations')
  @Roles(Role.OWNER, Role.ADMIN)
  async invite(
    @Param() { workspaceId }: WorkspaceParams,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const { value, errors, ok } = await parseForm(CreateInvitationDto, body);
    let extra: Record<string, unknown> = { inviteErrors: errors };
    let status = 400;
    if (ok) {
      try {
        const invitation = await this.invitations.create(
          workspaceId,
          user.id,
          value,
          req.membership!.role,
        );
        extra = {
          newInvite: {
            email: invitation.email,
            link: `${req.protocol}://${req.get('host')}/admin/invite/${invitation.token}`,
          },
        };
        status = 201;
      } catch (error) {
        const formError = toFormMessage(error);
        if (!formError) throw error;
        extra = { formError };
      }
    }
    return res
      .status(status)
      .render('admin/workspaces/team', await this.teamView(workspaceId, req, extra));
  }

  @Post(':workspaceId/invitations/:invitationId/delete')
  @Roles(Role.OWNER, Role.ADMIN)
  async revokeInvitation(
    @Param() { workspaceId, invitationId }: InvitationParams,
    @Res() res: Response,
  ) {
    await this.invitations.revoke(workspaceId, invitationId);
    return res.redirect(`/admin/workspaces/${workspaceId}/team?flash=deleted`);
  }

  // ---- views ---------------------------------------------------------------------------------

  private async homeView(workspaceId: string, userId: string, extra: Record<string, unknown> = {}) {
    const [ws, summary, google] = await Promise.all([
      this.workspaces.get(workspaceId),
      this.overview.summary(workspaceId),
      this.googleCalendar.status(userId, workspaceId),
    ]);
    return { title: ws.name, section: 'overview', wide: true, ws, summary, google, ...extra };
  }

  private async teamView(workspaceId: string, req: Request, extra: Record<string, unknown> = {}) {
    const workspace = await this.workspaces.get(workspaceId);
    const role = req.membership?.role;
    const canManage = role === Role.OWNER || role === Role.ADMIN;
    const [members, pendingInvitations] = await Promise.all([
      this.members.list(workspaceId),
      canManage ? this.invitations.list(workspaceId) : [],
    ]);
    return {
      title: `Team · ${workspace.name}`,
      section: 'team',
      ws: workspace,
      canManage,
      isOwner: role === Role.OWNER,
      isPlatformAdmin: req.user?.isPlatformAdmin === true,
      otherPlan: workspace.plan === Plan.PRO ? Plan.FREE : Plan.PRO,
      members: members.map((m) => ({
        ...m,
        roles: enumOptions(Object.values(Role), m.role),
        isSelf: m.userId === req.user?.id,
        // roles are handed out by owners only, and never to oneself
        canChangeRole: role === Role.OWNER && m.userId !== req.user?.id,
      })),
      newRoles: enumOptions(Object.values(Role), Role.MEMBER),
      inviteRoles: enumOptions(
        role === Role.OWNER ? [Role.MEMBER, Role.ADMIN] : [Role.MEMBER],
        Role.MEMBER,
      ),
      pendingInvitations,
      ...extra,
    };
  }

  private formView(view: {
    title: string;
    action: string;
    form?: Record<string, unknown>;
    errors?: Record<string, string>;
    formError?: string;
    ws?: { id: string; name: string };
  }) {
    return {
      ...view,
      nav: 'workspaces',
      section: 'overview',
      form: view.form ?? {},
      errors: view.errors ?? {},
    };
  }
}
