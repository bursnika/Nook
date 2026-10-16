import { Module } from '@nestjs/common';
import { NotesService } from './notes.service.js';
import { PagesController } from './pages.controller.js';
import { PagesService } from './pages.service.js';

@Module({
  controllers: [PagesController],
  providers: [PagesService, NotesService],
  exports: [PagesService, NotesService],
})
export class PagesModule {}
