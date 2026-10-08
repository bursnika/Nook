import { applyDecorators, Controller, UseFilters } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { AdminExceptionFilter } from './admin-exception.filter.js';

/** A server-rendered (MVC) controller: kept out of Swagger and wired to the HTML error page. */
export const AdminController = (path: string) =>
  applyDecorators(Controller(path), ApiExcludeController(), UseFilters(AdminExceptionFilter));
