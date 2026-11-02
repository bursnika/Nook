import { Controller, Get, Header, Param, Render } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../auth/decorators.js';
import { PublicService } from './public.service.js';

@ApiExcludeController()
@Public()
@Controller()
export class PublicController {
  constructor(private readonly publicPages: PublicService) {}

  @Get()
  @Header('Cache-Control', 'public, max-age=300')
  @Render('public/home')
  home() {
    return this.publicPages.home();
  }

  @Get('p/:slug')
  @Header('Cache-Control', 'public, max-age=60')
  @Render('public/page')
  landing(@Param('slug') slug: string) {
    return this.publicPages.landing(slug);
  }

  @Get('sitemap.xml')
  @Header('Content-Type', 'application/xml; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=300')
  sitemap() {
    return this.publicPages.sitemap();
  }

  @Get('robots.txt')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  robots() {
    return this.publicPages.robots();
  }
}
