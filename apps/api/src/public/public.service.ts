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
    const urls = pages
      .map(
        (p) =>
          `  <url><loc>${env.publicUrl}/p/${p.slug}</loc><lastmod>${p.updatedAt.toISOString()}</lastmod></url>`,
      )
      .join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
  }

  robots() {
    return `User-agent: *\nAllow: /p/\nDisallow: /admin\nDisallow: /api\nDisallow: /uploads\n\nSitemap: ${env.publicUrl}/sitemap.xml\n`;
  }
}
