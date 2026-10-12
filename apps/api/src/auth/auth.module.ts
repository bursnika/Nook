import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { GoogleProvider } from './google.provider.js';
import { OAUTH_PROVIDER } from './oauth.provider.js';
import { TokenService } from './token.service.js';
import { WorkspaceGuard } from './workspace.guard.js';

@Global()
@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    GoogleProvider,
    { provide: OAUTH_PROVIDER, useExisting: GoogleProvider },
    // Registered via useExisting so tests can swap the guard classes with overrideProvider().
    AuthGuard,
    WorkspaceGuard,
    { provide: APP_GUARD, useExisting: AuthGuard },
    { provide: APP_GUARD, useExisting: WorkspaceGuard },
  ],
  exports: [AuthService, TokenService],
})
export class AuthModule {}
