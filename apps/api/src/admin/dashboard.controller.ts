import { Get, Query, Render, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser, PlatformAdminOnly } from '../auth/decorators.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { UsersService } from '../users/users.service.js';
import { AdminController } from './admin-controller.decorator.js';
import { AdminListQuery } from './admin-query.js';
import { flashMessage, PAGE_SIZE, pager } from './forms.js';

@AdminController('admin')
export class DashboardController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
  ) {}

  @Get()
  @Render('admin/dashboard')
  async dashboard(@CurrentUser() user: AuthUser) {
    const mine = { memberships: { some: { userId: user.id } } };
    const workspaceWhere = user.isPlatformAdmin ? {} : mine;
    const inWorkspace = user.isPlatformAdmin ? {} : { workspace: mine };
    const [workspaces, users, pages, tasks, recent] = await Promise.all([
      this.prisma.workspace.count({ where: workspaceWhere }),
      user.isPlatformAdmin ? this.prisma.user.count() : Promise.resolve(null),
      this.prisma.page.count({ where: inWorkspace }),
      this.prisma.task.count({ where: inWorkspace }),
      this.prisma.workspace.findMany({ where: workspaceWhere, orderBy: { id: 'desc' }, take: 5 }),
    ]);
    return {
      title: 'Dashboard',
      nav: 'dashboard',
      stats: { workspaces, users, pages, tasks },
      recent,
    };
  }

  @Get('users')
  @PlatformAdminOnly()
  @Render('admin/users')
  async usersList(@Query() { page, q, flash }: AdminListQuery, @Req() req: Request) {
    const { items, total } = await this.users.list({
      q,
      skip: (page - 1) * PAGE_SIZE,
      limit: PAGE_SIZE,
    });
    return {
      title: 'Users',
      nav: 'users',
      flash: flashMessage(flash),
      q,
      users: items,
      pager: pager(req, total, page),
    };
  }
}
