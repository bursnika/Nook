import { applyDecorators, Controller, UseFilters, UseInterceptors } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { AdminExceptionFilter } from './admin-exception.filter.js';
import { AdminLocalsInterceptor } from './admin-locals.interceptor.js';

/** A server-rendered (MVC) controller: kept out of Swagger, wired to the HTML error page and the template locals. */
export const AdminController = (path: string) =>
  applyDecorators(
    Controller(path),
    ApiExcludeController(),
    UseFilters(AdminExceptionFilter),
    UseInterceptors(AdminLocalsInterceptor),
  );
