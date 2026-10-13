import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { LoginRedirectException } from '../auth/login-redirect.js';
import { Prisma } from '../generated/prisma/client.js';

/** Renders expected failures (404, 400, 409 ...) as an HTML page instead of the API's JSON. */
@Catch(HttpException, Prisma.PrismaClientKnownRequestError)
export class AdminExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException | Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    // "Sign in first" is not an error page: send the browser on to the sign-in flow.
    if (exception instanceof LoginRedirectException) return res.redirect(exception.location);

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Something went wrong.';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      const raw = typeof body === 'string' ? body : (body as { message?: unknown }).message;
      message = Array.isArray(raw) ? raw.join(', ') : String(raw ?? exception.message);
    } else if (exception.code === 'P2025') {
      status = HttpStatus.NOT_FOUND;
      message = 'Record not found.';
    } else if (exception.code === 'P2002') {
      status = HttpStatus.CONFLICT;
      message = 'A record with these unique values already exists.';
    }

    res.status(status).render('admin/error', { title: `Error ${status}`, status, message });
  }
}
