import { Module } from '@nestjs/common';
import { PageMarkdownController } from './markdown.controller.js';
import { PageMarkdownService } from './markdown.service.js';
import { NotesService } from './notes.service.js';
import { PagesController } from './pages.controller.js';
import { PagesService } from './pages.service.js';

@Module({
  controllers: [PagesController, PageMarkdownController],
  providers: [PagesService, NotesService, PageMarkdownService],
  exports: [PagesService, NotesService],
})
export class PagesModule {}
