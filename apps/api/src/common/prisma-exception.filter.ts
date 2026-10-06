import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { Prisma } from '../generated/prisma/client.js';

const MAPPING: Record<string, { status: HttpStatus; error: string; message: string }> = {
  P2025: { status: HttpStatus.NOT_FOUND, error: 'Not Found', message: 'Record not found' },
  P2002: {
    status: HttpStatus.CONFLICT,
    error: 'Conflict',
    message: 'A record with these unique values already exists',
  },
  P2003: {
    status: HttpStatus.CONFLICT,
    error: 'Conflict',
    message: 'Referenced record does not exist or is still in use',
  },
};

@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  catch(exception: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const mapped = MAPPING[exception.code];
    if (!mapped) {
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        error: 'Internal Server Error',
        message: 'Database error',
      });
      return;
    }
    res.status(mapped.status).json({
      statusCode: mapped.status,
      error: mapped.error,
      message: mapped.message,
    });
  }
}
