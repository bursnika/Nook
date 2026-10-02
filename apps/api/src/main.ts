import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApp, setupSwagger } from './app.setup.js';
import { env } from './env.js';

const app = await NestFactory.create(AppModule);
configureApp(app);
setupSwagger(app);
app.enableShutdownHooks();
await app.listen(env.port);
console.log(`Nook API listening on http://localhost:${env.port}/api (docs: /api/docs)`);
