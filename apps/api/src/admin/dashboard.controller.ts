import { Get, Query, Render, Req } from '@nestjs/common';
import type { Request } from 'express';
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
  async dashboard() {
    const [workspaces, users, pages, tasks, recent] = await Promise.all([
      this.prisma.workspace.count(),
      this.prisma.user.count(),
      this.prisma.page.count(),
      this.prisma.task.count(),
      this.prisma.workspace.findMany({ orderBy: { id: 'desc' }, take: 5 }),
    ]);
    return {
      title: 'Dashboard',
      nav: 'dashboard',
      stats: { workspaces, users, pages, tasks },
      recent,
    };
  }

  /** Read-only view over the whole user table (millions of rows), with search and paging. */
  @Get('users')
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
