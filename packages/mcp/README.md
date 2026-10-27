# @nook/mcp

MCP-сервер (stdio) для планувальника Nook. Це тонка обгортка над REST API (`/api`): асистент (Claude Desktop, Claude Code тощо) читає сторінки, задачі й календар та може створювати задачі й дописувати блоки до сторінок.

## Змінні середовища

| Змінна              | Значення за замовчуванням   | Опис                                                                        |
| ------------------- | --------------------------- | --------------------------------------------------------------------------- |
| `NOOK_API_URL`      | `http://localhost:3000/api` | Базовий URL API разом із префіксом `/api`.                                  |
| `NOOK_TOKEN`        | немає (обов'язкова)         | JWT доступу, надсилається як `Authorization: Bearer`.                       |
| `NOOK_WORKSPACE_ID` | немає                       | Робочий простір за замовчуванням. Кожен інструмент приймає й `workspaceId`. |

Без `NOOK_TOKEN` інструменти повертають помилку з поясненням, сервер не падає.

## Збірка і запуск

```bash
pnpm install
pnpm --filter @nook/mcp build
pnpm --filter @nook/mcp test
NOOK_TOKEN=... NOOK_WORKSPACE_ID=... pnpm --filter @nook/mcp start
```

Збирати потрібно перед реєстрацією в клієнті: він запускає `packages/mcp/dist/index.js`. API має працювати (у Docker або локально), Swagger: `http://localhost:3000/api/docs`.

## Як отримати токен для локальної розробки

Токен живе недовго, тому за потреби його отримують знову.

1. **З браузера.** Увійдіть у Nook через Google, відкрийте DevTools, Application, Cookies і скопіюйте значення cookie `nook_at`. Воно дійсне 15 хвилин.
2. **Згенерувати самому (лише для dev).** Потрібні `JWT_SECRET` того самого середовища, що й запущений API (для Docker це `infra/.env`), `id` і пошта користувача. Для демо-користувача (вигадані дані з сидів) це:

   ```bash
   cd apps/api
   node --env-file=../../infra/.env --input-type=module -e "
   import { SignJWT } from 'jose';
   const [id, email] = process.argv.slice(1);
   console.log(await new SignJWT({ email }).setProtectedHeader({ alg: 'HS256' })
     .setSubject(id).setIssuer('nook').setAudience('nook-api').setIssuedAt()
     .setExpirationTime('8h').sign(new TextEncoder().encode(process.env.JWT_SECRET)));
   " <USER_ID> <USER_EMAIL>
   ```

   Секрет не друкується й не комітиться; токен нікому не передавайте.

`NOOK_WORKSPACE_ID` можна взяти з Swagger (`GET /api/workspaces`) або з адреси сторінки в застосунку.

## Claude Desktop

У `claude_desktop_config.json` (Settings, Developer, Edit Config) додайте:

```json
{
  "mcpServers": {
    "nook": {
      "command": "node",
      "args": ["/абсолютний/шлях/до/webtechnology_lab1/packages/mcp/dist/index.js"],
      "env": {
        "NOOK_API_URL": "http://localhost:3000/api",
        "NOOK_TOKEN": "<JWT>",
        "NOOK_WORKSPACE_ID": "<id робочого простору>"
      }
    }
  }
}
```

Перезапустіть Claude Desktop.

## Claude Code

```bash
claude mcp add nook \
  --env NOOK_API_URL=http://localhost:3000/api \
  --env NOOK_TOKEN=<JWT> \
  --env NOOK_WORKSPACE_ID=<id робочого простору> \
  -- node /абсолютний/шлях/до/webtechnology_lab1/packages/mcp/dist/index.js
```

Перевірка: `claude mcp list` або `/mcp` у сесії.

## Інструменти

Читання:

| Інструмент    | Параметри                                                                                                             | Приклад запиту                                                |
| ------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `list_pages`  | `parentId?` (id або `root`), `skip?`, `limit?`                                                                        | «Покажи сторінки верхнього рівня в Nook»                      |
| `get_page`    | `pageId`                                                                                                              | «Відкрий сторінку Ideas і перекажи її вміст»                  |
| `list_tasks`  | `status?` (TODO, IN_PROGRESS, ON_HOLD, DONE), `priority?` (LOW, MEDIUM, HIGH), `dueTo?`, `pageId?`, `skip?`, `limit?` | «Які задачі з високим пріоритетом треба зробити до п'ятниці?» |
| `list_events` | `from?`, `to?` (ISO 8601, до 100 днів; за замовчуванням наступні 14 днів)                                             | «Що в мене в календарі на цьому тижні?»                       |
| `search`      | `query`, `limit?`                                                                                                     | «Знайди все про roadmap»                                      |

Запис:

| Інструмент     | Параметри                                                                                                    | Приклад запиту                                                     |
| -------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `create_task`  | `title`, `description?`, `priority?`, `dueDate?`, `pageId?`                                                  | «Створи задачу "Здати лабу" з високим пріоритетом на 10 листопада» |
| `append_block` | `pageId`, `type` (PARAGRAPH, HEADING_1..3, BULLETED_LIST, NUMBERED_LIST, TODO, QUOTE, CODE, DIVIDER), `text` | «Допиши на сторінку Ideas пункт TODO "Подзвонити в деканат"»       |

Усі інструменти приймають необов'язковий `workspaceId`, який має пріоритет над `NOOK_WORKSPACE_ID`. Помилки API (наприклад, `Record not found` або повідомлення валідації) повертаються як помилка інструмента (`isError`), а не обривають сервер.
