import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';

/** Makes the signed-in user and their role in the current workspace available to every Handlebars template. */
@Injectable()
export class AdminLocalsInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    res.locals.currentUser = req.user;
    res.locals.role = req.membership?.role;
    return next.handle();
  }
}
