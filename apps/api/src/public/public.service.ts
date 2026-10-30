import { Injectable, NotFoundException } from '@nestjs/common';
import { env } from '../env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { describe, safeJson, toViewNodes } from './blocks-view.js';

const SITE_NAME = 'Nook';

/** Absolute URL for a link stored as `/uploads/...` or as a full address. */
const absolute = (link: string | null) =>
  link ? (link.startsWith('/') ? `${env.publicUrl}${link}` : link) : undefined;

@Injectable()
export class PublicService {
  constructor(private readonly prisma: PrismaService) {}

  /** The product landing page at `/`, with its own SEO tags and structured data. */
  home() {
    const description =
      'Nook is a pixel-cute planner: notes, a Jira-style Kanban board, a calendar with Google sync, live collaboration and an AI assistant, all in one retro desktop.';
    const title = 'Nook, a pixel-cute planner for notes, tasks and your calendar';
    const jsonLd = {
      '@context': 'https://schema.org',
      '@type': 'WebApplication',
      name: SITE_NAME,
      url: env.publicUrl,
      description,
      applicationCategory: 'ProductivityApplication',
      operatingSystem: 'Any (web, installable as a PWA)',
      offers: [
        { '@type': 'Offer', name: 'Free', price: '0', priceCurrency: 'USD' },
        { '@type': 'Offer', name: 'Pro', priceCurrency: 'USD' },
      ],
    };
    return {
      layout: false,
      title,
      description,
      canonical: `${env.publicUrl}/`,
      siteName: SITE_NAME,
      gaId: env.gaMeasurementId,
      jsonLd: safeJson(jsonLd),
      appUrl: '/app/',
    };
  }

  /** Everything the landing page needs, SEO tags included. Unpublished pages do not exist for the public. */
  async landing(slug: string) {
    const page = await this.prisma.page.findFirst({
      where: { slug, isPublished: true },
      include: {
        blocks: { orderBy: { position: 'asc' } },
        author: { select: { name: true, email: true, avatarUrl: true } },
      },
    });
    if (!page) throw new NotFoundException('Page not found');
    const url = `${env.publicUrl}/p/${page.slug}`;
    const description =
      describe(page.blocks) || `${page.title}: a page published with ${SITE_NAME}.`;
    const image = absolute(page.coverUrl);
    const jsonLd = {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: page.title,
      description,
      url,
      mainEntityOfPage: url,
      datePublished: page.createdAt.toISOString(),
      dateModified: page.updatedAt.toISOString(),
      author: { '@type': 'Person', name: page.author.name, email: page.author.email },
      publisher: { '@type': 'Organization', name: SITE_NAME },
      ...(image ? { image } : {}),
    };
    return {
      layout: 'public/layout',
      title: page.title,
      description,
      canonical: url,
      image,
      siteName: SITE_NAME,
      gaId: env.gaMeasurementId,
      jsonLd: safeJson(jsonLd),
      page: {
        title: page.title,
        icon: page.icon,
        coverUrl: page.coverUrl,
        createdAt: page.createdAt,
        updatedAt: page.updatedAt,
      },
      nodes: toViewNodes(page.blocks),
      author: page.author,
    };
  }

  async sitemap() {
    const pages = await this.prisma.page.findMany({
      where: { isPublished: true, slug: { not: null } },
      select: { slug: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
      take: 50000,
    });
    const urls = [
      `  <url><loc>${env.publicUrl}/</loc></url>`,
      ...pages.map(
        (p) =>
          `  <url><loc>${env.publicUrl}/p/${p.slug}</loc><lastmod>${p.updatedAt.toISOString()}</lastmod></url>`,
      ),
    ].join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
  }

  robots() {
    return `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api\nDisallow: /uploads\n\nSitemap: ${env.publicUrl}/sitemap.xml\n`;
  }
}
