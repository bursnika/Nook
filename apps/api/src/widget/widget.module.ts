import { Module } from '@nestjs/common';
import { WidgetController } from './widget.controller.js';
import { WidgetService } from './widget.service.js';

@Module({ controllers: [WidgetController], providers: [WidgetService] })
export class WidgetModule {}
