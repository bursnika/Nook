# Nook

Notion-подібний планер: блокові нотатки, задачі, календар із синхронізацією з Google Calendar, а згодом — віджети для ноутбука й телефона.

Проєкт виконується в межах курсу «Web-технології».

## Стек

- **Backend:** NestJS, Prisma, PostgreSQL, REST, GraphQL, WebSocket, MVC-адмінка (Handlebars + Bootstrap)
- **Frontend:** React, Vite, TypeScript
- **Infra:** Docker Compose, GitHub Actions, Azure

## Структура

```
apps/api        бекенд (REST, GraphQL, WebSocket, MVC-адмінка)
apps/web        SPA-застосунок
packages/shared спільні типи та схеми
packages/mcp    MCP-сервер
infra/          Docker Compose, Dockerfile-и
tests/          Postman, Playwright
docs/           звіти та документація
```

## Локальний запуск

Потрібні Node 22, pnpm і Docker.

```bash
pnpm install
cp .env.example apps/api/.env

# Postgres (порт 5433, щоб не конфліктувати з локальним 5432)
docker compose -f infra/docker-compose.yml up -d postgres

pnpm --filter @nook/api db:generate   # Prisma-клієнт
pnpm --filter @nook/api db:migrate    # міграції
pnpm --filter @nook/api db:seed       # демо-дані
pnpm --filter @nook/api start:dev     # http://localhost:3000/api
```

Swagger: <http://localhost:3000/api/docs>

### Адмінка (MVC)

Серверна адмінка на Handlebars + Bootstrap + jQuery/Select2: <http://localhost:3000/admin>

- CRUD для воркспейсів, сторінок (з обкладинкою-файлом), задач, тегів і вкладень, керування учасниками.
- Поля вибору (автор, виконавець, батьківська сторінка, теги, користувач) — Select2 з автопошуком: запит на сервер іде від 3 символів із паузою 300 мс.
- Щоб побачити автопошук на великому обсязі, згенеруйте мільйон користувачів (~30 с):

```bash
pnpm --filter @nook/api db:seed:users          # 1 000 000
pnpm --filter @nook/api db:seed:users 50000    # або свою кількість
```

Пошук підрядка прискорюють GIN-індекси `pg_trgm` (міграція `user_search_indexes`).

### Увесь стек у Docker

```bash
docker compose -f infra/docker-compose.yml up -d --build --wait
curl localhost:3000/api/health
```

Сервіс `migrate` застосовує міграції й завершується, після цього стартує `api`. Завантажені файли лежать у томі `uploads`.

### Тести

```bash
pnpm --filter @nook/api test:e2e   # e2e проти окремої БД nook_test
```
