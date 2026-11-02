import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import type { Response } from 'express';

export class LoginRedirectException extends HttpException {
  constructor(readonly location: string) {
    super('Sign-in required', 302);
  }
}

@Catch(LoginRedirectException)
export class LoginRedirectFilter implements ExceptionFilter {
  catch(exception: LoginRedirectException, host: ArgumentsHost) {
    host.switchToHttp().getResponse<Response>().redirect(exception.location);
  }
}
