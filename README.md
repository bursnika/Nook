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

- CRUD для воркспейсів, сторінок (з обкладинкою-файлом), задач і вкладень, керування учасниками.
- Поля вибору (автор, виконавець, батьківська сторінка, користувач) — Select2 з автопошуком: запит на сервер іде від 3 символів із паузою 300 мс.
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
- **Ролі:** `MEMBER` працює з вмістом; `ADMIN` ще й змінює воркспейс, запрошує людей (лише як `MEMBER`) і видаляє учасників, крім власників; `OWNER` ще й видає ролі, запрошує адмінів, перемикає план та видаляє воркспейс. Ролі видає тільки власник і ніхто не може змінити роль собі. Остання роль `OWNER` не може зникнути.
- **Запрошення:** адмін створює посилання `/admin/invite/<token>` (показується один раз, у БД лише хеш). Прийняти його може тільки власник тієї пошти.
- **Плани й фіче-флаги:** воркспейс на `FREE` або `PRO`. Pro-можливості (`insights`, `google-two-way-sync`, `ai-assistant`) закриті декоратором `@RequireFeature()`: `403` з кодом `FEATURE_NOT_AVAILABLE`. Флаг можна вимкнути для всіх у таблиці `FeatureFlag`. Приклад: `GET /api/workspaces/:id/insights`.
- **Платформенні адміни** (`ADMIN_EMAILS`) бачать усі воркспейси й повний список користувачів.
- **CSRF:** cookie `SameSite=Lax` плюс перевірка `Origin` для небезпечних методів. Вихід: `POST /api/auth/logout`.

### Google Calendar і Google Tasks

Окрема згода на доступ (інкрементальна авторизація, scope `calendar.readonly` і `tasks.readonly`): на головній сторінці воркспейсу кнопка **Connect Google Calendar**. Той самий redirect URI, що й для входу, додавати новий не треба.

1. У Google Cloud Console для того ж проєкту ввімкніть **Google Calendar API** і **Google Tasks API** (APIs & Services → Library).
2. Додайте scope `…/auth/calendar.readonly` і `…/auth/tasks.readonly` на екрані Google Auth Platform → Data Access. Поки проєкт у режимі Testing, працює для Test users.
3. На сторінці воркспейсу: **Connect** → згода Google (залиште обидві галочки) → **Sync now**.

Що імпортується (від −30 до +180 днів):

- **Події з усіх календарів, які ввімкнені в Google Calendar:** основний, підписки, свята, дні народження, календарі навчання. Календарі, приховані в Google, і календарі лише з free/busy пропускаються. Повторювані події розгортаються, подія, що лежить у кількох календарях, показується один раз, а в списку дня видно, з якого календаря вона.
- **Завдання з Google Tasks** (усі списки): відкриті та виконані за останні 30 днів, із нотатками й датою. Дата в Google без часу, тому в Nook це 12:00 UTC цього дня. Локальний статус «in progress» синхронізація не скидає, але назву, нотатки й дату бере з Google.
- Видалене в Google зникає й у Nook. Події та завдання, створені в Nook, синхронізація не чіпає. Календар або список, який Google цього разу не віддав, зберігає вже імпортоване.

#### Редагування подій з Nook (Pro)

Клік по події в календарі відкриває вікно, як у Google Calendar: перегляд, а далі ✎ редагування (назва, дата й час, «весь день», опис) і 🗑 видалення. Власні події Nook змінюються завжди. **Події з Google змінюються в самому Google Calendar**, якщо одночасно:

- воркспейс на плані **Pro** (флаг `google-two-way-sync`, інакше `403 FEATURE_NOT_AVAILABLE`);
- дано окремий дозвіл на запис: на сторінці воркспейсу посилання **Allow editing Google events** (scope `…/auth/calendar.events`, його також додайте в Data Access). Решта функцій працює і без нього;
- це подія з вашого календаря, де ви можете редагувати: календарі свят, днів народження чи «лише перегляд», події з Gmail і ті, де ви лише гість, змінити не можна;
- для повторюваної події зміна стосується **лише цього входження** (як «This event» у Google).

Зміна спершу йде в Google, і лише після успіху оновлюється локальна копія, тож вони не розходяться. Якщо подію вже видалили в Google, її прибере й Nook. Загальні `PATCH`/`DELETE /events/:id` для подій з Google відповідають `409`, щоб локальна правка не загубилась при наступній синхронізації. Гості події листів про зміну не отримують (`sendUpdates=none`).

**Створення подій.** Нова подія з календаря потрапляє і в Google, якщо діють ті самі умови (Pro + дозвіл на запис). У швидкій формі є галочка **Also add to my Google Calendar** (за замовчуванням увімкнена, на плані Free її немає), а кнопка **More options…** відкриває повне вікно з описом і «весь день». Подія створюється в основному календарі Google, без повторів і без запрошення гостей. Спершу запис іде в Google, і лише після успіху з'являється локальна копія, тому при відмові Google нічого не лишається наполовину. Знявши галочку, ви створите звичайну подію лише в Nook.

Безпека й приватність: refresh-токен зберігається зашифрованим (AES-256-GCM, ключ виводиться з `JWT_SECRET`, тож після його зміни календар підключають знову). Імпортовані події й завдання бачать усі учасники воркспейсу, про це нагадує підказка біля кнопки. **Disconnect** видаляє підключення, повідомляє Google про відкликання й прибирає все імпортоване в усіх воркспейсах. Якщо підключення зроблено до появи Google Tasks, біля кнопок буде посилання «Also import Google Tasks».

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
- `workspace-home.e2e-spec.ts`: завдання й події на 24 години, пріоритетні, швидке додавання таски, діапазон календаря, швидкі нотатки.
- `google-calendar.e2e-spec.ts`: підключення (згода, state, scope), синхронізація, відключення; Google підміняється фейком.
- Решта специфікацій перевіряє бізнес-правила від імені платформенного адміна.
