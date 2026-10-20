# Postman / Newman: тести REST API Nook

Колекція `nook.postman_collection.json` (Postman v2.1) перевіряє реальний REST API (`/api`) без жодних заздалегідь підготовлених даних: вона сама створює робочий простір, проходить увесь життєвий цикл сутностей і в кінці видаляє все за собою.

## Що покрито

158 запитів, у кожному є `pm.test` (статус, форма відповіді, значення). Id між запитами передаються через змінні колекції, які виставляють тести.

| Папка                      | Що перевіряється                                                                                          |
| -------------------------- | --------------------------------------------------------------------------------------------------------- |
| 01 Health and auth guard   | `GET /health`, 401 без токена та з невалідним токеном, `GET /auth/me`                                     |
| 02 Workspaces              | створення, список із пошуком і пагінацією, отримання, оновлення, 409 (дубль slug), 400 (валідація)        |
| 03 Members and invitations | список учасників, 403/409 для ролей, створення, перелік, відкликання (204) та прийняття запрошень         |
| 04 Features and plan       | `features`, 403 `FEATURE_NOT_AVAILABLE` на FREE, перемикання плану, `insights` на PRO                     |
| 05 Pages                   | CRUD, вкладені сторінки, фільтри `q` / `parentId`, пагінація `{items,total,skip,limit,nextLink}`, 409     |
| 06 Blocks                  | CRUD, типи, JSON-вміст, порядок за `position`                                                             |
| 07 Tasks                   | CRUD, фільтри (`status`, `priority`, `assigneeId`, `pageId`, `dueFrom/dueTo`, `q`), `completedAt`, `null` |
| 08 Calendar events         | CRUD, фільтри `from` / `to` / `q`, перевірка діапазону дат, прив'язка до задачі                           |
| 09 Overview and calendar   | `GET /overview`, `GET /calendar?from&to`, помилки діапазону (400)                                         |
| 10 Tenancy                 | 404 для чужого робочого простору (замість 403, щоб не можна було перебирати id)                           |
| 11 Cleanup                 | видалення (204) подій, задач, сторінок і самого простору; перевірка, що нічого не лишилось                |

Примітки:

- Чужий робочий простір імітується випадковим UUID (`{{$guid}}`): гард тенантів відповідає однаково (404) і для неіснуючого, і для чужого простору, а другого користувача колекція не створює.
- Вкладення (multipart) та Google Calendar у колекцію не входять.

## Змінні

- `baseUrl` (середовище): за замовчуванням `http://localhost:3000/api`.
- `token` (середовище): JWT користувача `newman@nook.local`. У репозиторії лише порожній плейсхолдер, справжній токен не зберігається.
- Решту змінних (`runId`, `workspaceId`, `pageId`, `taskId` тощо) виставляє сама колекція, їх не треба задавати.

## Запуск локально

Потрібні Node 22+, pnpm, запущена база даних і API (наприклад, `pnpm --filter @nook/api start:dev`). Токен генерує скрипт `apps/api/scripts/postman-seed.ts` (`pnpm --filter @nook/api -s postman:token`): він ідемпотентно створює користувача `newman@nook.local` і друкує в stdout лише JWT на 60 хвилин, підписаний `JWT_SECRET` та з `DATABASE_URL` з `apps/api/.env`.

```bash
pnpm install
pnpm -s test:newman
```

Скрипт `tests/postman/run.mjs` отримує токен, запускає Newman із репортерами `cli` та `junit`, звіт JUnit пишеться в `tests/postman/results/newman.xml` (каталог у `.gitignore`). Додаткові аргументи передаються Newman: `pnpm -s test:newman --bail`. Інший адрес API можна задати через `NEWMAN_BASE_URL`.

## Запуск проти Docker

```bash
docker compose -f infra/docker-compose.yml up -d --build --wait
NEWMAN_ENV_FILE=infra/.env pnpm -s test:newman
```

Контейнер підписує токени `JWT_SECRET` з `infra/.env`, який зазвичай відрізняється від `apps/api/.env`, тому шлях до нього передається у `NEWMAN_ENV_FILE` (інакше API відповість 401). База даних Docker доступна на хості через порт 5433, саме його вказує `DATABASE_URL` в `apps/api/.env`.

Якщо раніше запуск було перервано, скрипт токена сам видаляє залишені робочі простори `newman-*` цього користувача.

## Імпорт у Postman

1. Postman: **Import** і вибрати `tests/postman/nook.postman_collection.json` та `tests/postman/local.postman_environment.json`.
2. Обрати середовище **Nook local** і в змінній `token` вставити JWT (`pnpm --filter @nook/api -s postman:token`).
3. Запустити колекцію через **Run collection**. Запити залежать один від одного, тож виконувати їх треба по порядку, з першого (`Health check`, він генерує свіжі змінні запуску).
