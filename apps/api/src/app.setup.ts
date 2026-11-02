import { INestApplication, RequestMethod, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import hbs from 'hbs';
import type { Express } from 'express';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { registerViewHelpers } from './admin/view-helpers.js';
import { LoginRedirectFilter } from './auth/login-redirect.js';
import { IMPORT_BODY_LIMIT, limitJsonBodies } from './common/body-limit.js';
import { PrismaExceptionFilter } from './common/prisma-exception.filter.js';
import { env } from './env.js';
import {
  FILE_STORAGE,
  UPLOAD_PREFIX,
  UPLOAD_RESPONSE_HEADERS,
  type FileStorage,
} from './uploads/file-storage.js';
import { serveUploadsFromStorage } from './uploads/serve-uploads.js';

export function configureApp(app: INestApplication) {
  app.setGlobalPrefix('api', {
    exclude: [
      { path: 'admin', method: RequestMethod.ALL },
      { path: 'admin/*path', method: RequestMethod.ALL },
      { path: 'graphql', method: RequestMethod.ALL },
      { path: '/', method: RequestMethod.GET },
      { path: 'p/:slug', method: RequestMethod.GET },
      { path: 'sitemap.xml', method: RequestMethod.GET },
      { path: 'robots.txt', method: RequestMethod.GET },
    ],
  });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.use(limitJsonBodies);
  (app as NestExpressApplication).useBodyParser('json', { limit: IMPORT_BODY_LIMIT });
  app.use(cookieParser());
  app.useGlobalFilters(new PrismaExceptionFilter(), new LoginRedirectFilter());

  setupViews(app as NestExpressApplication);
  setupSpa(app as NestExpressApplication);

  setupUploads(app as NestExpressApplication);
}

function setupUploads(app: NestExpressApplication) {
  const storage = app.get<FileStorage>(FILE_STORAGE);
  if (!storage.staticRoot) {
    serveUploadsFromStorage(app.getHttpAdapter().getInstance() as Express, storage);
    return;
  }
  app.useStaticAssets(storage.staticRoot, {
    prefix: UPLOAD_PREFIX,
    index: false,
    setHeaders: (res) => {
      for (const [name, value] of Object.entries(UPLOAD_RESPONSE_HEADERS))
        res.setHeader(name, value);
    },
  });
}

export function setupSwagger(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle('Nook API')
    .setDescription('REST API of the Nook planner')
    .setVersion('0.1.0')
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, config));
}

// @types/hbs doesn't know the rename option
interface HbsWithPartialOptions {
  registerPartials(dir: string, options: { rename: (name: string) => string }): void;
}

const require = createRequire(import.meta.url);
const packageDir = (name: string) => dirname(require.resolve(`${name}/package.json`));

function setupViews(app: NestExpressApplication) {
  const views = join(env.appRoot, 'views');
  app.setBaseViewsDir(views);
  app.setViewEngine('hbs');
  app.set('view options', { layout: 'admin/layout' });
  // otherwise hbs turns field-text into field_text
  (hbs as unknown as HbsWithPartialOptions).registerPartials(join(views, 'partials'), {
    rename: (name) => name,
  });
  registerViewHelpers(hbs);

  app.useStaticAssets(join(env.appRoot, 'public'), { prefix: '/static/' });
  const vendor: Record<string, string> = {
    bootstrap: join(packageDir('bootstrap'), 'dist'),
    jquery: join(packageDir('jquery'), 'dist'),
    select2: join(packageDir('select2'), 'dist'),
    'select2-theme': join(packageDir('select2-bootstrap-5-theme'), 'dist'),
  };
  for (const [name, dir] of Object.entries(vendor)) {
    app.useStaticAssets(dir, { prefix: `/static/vendor/${name}/`, index: false });
  }
}

// unknown /app/* paths get index.html for the client router
function setupSpa(app: NestExpressApplication) {
  const server = app.getHttpAdapter().getInstance() as Express;
  const index = join(env.webDist, 'index.html');
  if (!existsSync(index)) return;
  app.useStaticAssets(env.webDist, { prefix: '/app/', index: false, maxAge: '1h' });
  server.get(['/app', '/app/*path'], (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(index);
  });
}
