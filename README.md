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
cp .env.example apps/api/.env   # і заповніть JWT_SECRET (див. «Вхід і ролі» нижче)

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

### Вхід і ролі

Вхід лише через Google (OAuth2, authorization code + PKCE). Після входу API видає короткий JWT (15 хв) і refresh-токен у httpOnly cookie; refresh ротується, а повторне використання старого токена скасовує всі сесії.

1. У [Google Cloud Console](https://console.cloud.google.com/apis/credentials) створіть OAuth client типу «Web application» і додайте redirect URI `http://localhost:3000/api/auth/google/callback`. Поки проєкт у режимі Testing, додайте свою пошту в Test users.
2. У `apps/api/.env` заповніть `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `JWT_SECRET` (≥ 32 символи: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`) і `ADMIN_EMAILS` (ваша пошта).
3. Відкрийте <http://localhost:3000/admin>: вас перекине на вхід через Google. Файл `.env` у git не потрапляє. Не комітьте `client_secret*.json`.

Права:

- **Воркспейс = тенант.** Користувач бачить лише воркспейси, у яких є членство; чужий воркспейс відповідає `404`, так само як неіснуючий.
- **Ролі:** `MEMBER` працює з вмістом; `ADMIN` ще й змінює воркспейс, запрошує людей, керує учасниками (крім власників); `OWNER` ще й перемикає план та видаляє воркспейс. Остання роль `OWNER` не може зникнути.
- **Запрошення:** адмін створює посилання `/admin/invite/<token>` (показується один раз, у БД лише хеш). Прийняти його може тільки власник тієї пошти.
- **Плани й фіче-флаги:** воркспейс на `FREE` або `PRO`. Pro-можливості (`insights`, `google-two-way-sync`, `ai-assistant`) закриті декоратором `@RequireFeature()`: `403` з кодом `FEATURE_NOT_AVAILABLE`. Флаг можна вимкнути для всіх у таблиці `FeatureFlag`. Приклад: `GET /api/workspaces/:id/insights`.
- **Платформенні адміни** (`ADMIN_EMAILS`) бачать усі воркспейси й повний список користувачів.
- **CSRF:** cookie `SameSite=Lax` плюс перевірка `Origin` для небезпечних методів. Вихід: `POST /api/auth/logout`.

### Увесь стек у Docker

```bash
cp infra/.env.example infra/.env      # заповніть JWT_SECRET (обов'язково), за потреби GOOGLE_* та ADMIN_EMAILS
docker compose -f infra/docker-compose.yml up -d --build --wait
curl localhost:3000/api/health
```

Сервіс `migrate` застосовує міграції й завершується, після цього стартує `api`. Завантажені файли лежать у томі `uploads`. Без `JWT_SECRET` compose відмовиться стартувати. Під HTTPS виставте `COOKIE_SECURE=true`.

### Тести

```bash
pnpm --filter @nook/api test        # unit
pnpm --filter @nook/api test:e2e    # e2e проти окремої БД nook_test (створюється сама)
```

- `auth.e2e-spec.ts` (QA3): вхід через підроблений OAuth-провайдер, відсутній / прострочений / підроблений токен, ротація refresh і виявлення повторного використання, вихід, CSRF.
- `tenancy.e2e-spec.ts`: ізоляція тенантів на всіх маршрутах, матриця ролей, запрошення, плани й фіче-флаги, захищена адмінка.
- Решта специфікацій перевіряє бізнес-правила від імені платформенного адміна.
