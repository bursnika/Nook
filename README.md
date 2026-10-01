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

Потрібні Node 22 і pnpm.

```bash
pnpm install
```
