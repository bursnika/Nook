import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

export const LOOKUP_PAGE_SIZE = 20;
/** Searching a table with millions of rows by one or two letters is pointless, so the server enforces it too. */
export const LOOKUP_MIN_CHARS = 3;

export interface LookupResult {
  results: { id: string; text: string }[];
  more: boolean;
}

const EMPTY: LookupResult = { results: [], more: false };

/** Option lists for the Select2 autocompletes in the admin forms. */
@Injectable()
export class LookupService {
  constructor(private readonly prisma: PrismaService) {}

  async users(q: string, page: number): Promise<LookupResult> {
    if (q.length < LOOKUP_MIN_CHARS) return EMPTY;
    const rows = await this.prisma.user.findMany({
      where: {
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { email: { contains: q, mode: 'insensitive' } },
        ],
      },
      orderBy: { id: 'desc' },
      select: { id: true, name: true, email: true },
      ...this.window(page),
    });
    return this.toResult(rows.map((u) => ({ id: u.id, text: `${u.name} · ${u.email}` })));
  }

  async members(workspaceId: string, q: string, page: number): Promise<LookupResult> {
    const rows = await this.prisma.membership.findMany({
      where: {
        workspaceId,
        ...(q
          ? {
              user: {
                OR: [
                  { name: { contains: q, mode: 'insensitive' } },
                  { email: { contains: q, mode: 'insensitive' } },
                ],
              },
            }
          : {}),
      },
      orderBy: { id: 'asc' },
      select: { user: { select: { id: true, name: true, email: true } } },
      ...this.window(page),
    });
    return this.toResult(
      rows.map(({ user }) => ({ id: user.id, text: `${user.name} · ${user.email}` })),
    );
  }

  async pages(workspaceId: string, q: string, page: number): Promise<LookupResult> {
    const rows = await this.prisma.page.findMany({
      where: { workspaceId, ...(q ? { title: { contains: q, mode: 'insensitive' } } : {}) },
      orderBy: { title: 'asc' },
      select: { id: true, title: true, icon: true },
      ...this.window(page),
    });
    return this.toResult(
      rows.map((p) => ({ id: p.id, text: `${p.icon ? `${p.icon} ` : ''}${p.title}` })),
    );
  }

  async tags(workspaceId: string, q: string, page: number): Promise<LookupResult> {
    const rows = await this.prisma.tag.findMany({
      where: { workspaceId, ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}) },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
      ...this.window(page),
    });
    return this.toResult(rows.map((t) => ({ id: t.id, text: t.name })));
  }

  // One extra row tells Select2 whether another page exists.
  private window(page: number) {
    return { skip: (page - 1) * LOOKUP_PAGE_SIZE, take: LOOKUP_PAGE_SIZE + 1 };
  }

  private toResult(rows: LookupResult['results']): LookupResult {
    return { results: rows.slice(0, LOOKUP_PAGE_SIZE), more: rows.length > LOOKUP_PAGE_SIZE };
  }
}
