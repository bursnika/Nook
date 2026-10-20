import { INestApplication, RequestMethod, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import hbs from 'hbs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { registerViewHelpers } from './admin/view-helpers.js';
import { LoginRedirectFilter } from './auth/login-redirect.js';
import { PrismaExceptionFilter } from './common/prisma-exception.filter.js';
import { env } from './env.js';

/** Shared by main.ts and the e2e tests so both run the app exactly the same way. */
export function configureApp(app: INestApplication) {
  // The REST API lives under /api; the server-rendered admin (MVC) is mounted at /admin.
  app.setGlobalPrefix('api', {
    exclude: [
      { path: 'admin', method: RequestMethod.ALL },
      { path: 'admin/*path', method: RequestMethod.ALL },
      { path: 'graphql', method: RequestMethod.ALL },
      { path: 'p/:slug', method: RequestMethod.GET },
      { path: 'sitemap.xml', method: RequestMethod.GET },
      { path: 'robots.txt', method: RequestMethod.GET },
    ],
  });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.use(cookieParser());
  app.useGlobalFilters(new PrismaExceptionFilter(), new LoginRedirectFilter());

  setupViews(app as NestExpressApplication);

  // Uploaded files are user content: never let the browser sniff or run them in our origin.
  (app as NestExpressApplication).useStaticAssets(env.uploadDir, {
    prefix: '/uploads/',
    index: false,
    setHeaders: (res) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; img-src 'self'");
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

/** @types/hbs predates the `rename` option of registerPartials. */
interface HbsWithPartialOptions {
  registerPartials(dir: string, options: { rename: (name: string) => string }): void;
}

const require = createRequire(import.meta.url);
const packageDir = (name: string) => dirname(require.resolve(`${name}/package.json`));

/** Handlebars views plus the static assets they need (own css/js and vendored Bootstrap, jQuery, Select2). */
function setupViews(app: NestExpressApplication) {
  const views = join(env.appRoot, 'views');
  app.setBaseViewsDir(views);
  app.setViewEngine('hbs');
  app.set('view options', { layout: 'admin/layout' });
  // keep file names as partial names (hbs would otherwise turn field-text into field_text)
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
