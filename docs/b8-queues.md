# B8. Черги повідомлень (RabbitMQ)

Фонова синхронізація Google Calendar іде через чергу, а не виконується в HTTP-запиті чи таймері напряму. Код працює з абстракцією `MessageQueue` (`apps/api/src/queue`), драйвер обирається змінною `AMQP_URL`.

## Драйвери

| Драйвер         | Коли                                          | Особливості                                                                                                |
| --------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `RabbitMqQueue` | задано `AMQP_URL`                             | `amqplib`; durable-черги, persistent-повідомлення, publisher confirms, prefetch, перепідключення           |
| `InMemoryQueue` | типовий (без `AMQP_URL`), його ж беруть тести | та сама семантика (порядок, prefetch, retry, dead-letter) у процесі; після перезапуску нічого не лишається |

Інтерфейс: `publish(queue, payload, { messageId })`, `subscribe(queue, handler, { prefetch, maxAttempts, retryDelayMs })`, `status()`, `close()`. Обробник, що завершився, = **ack**; обробник, що кинув помилку, = **nack** (повтор із затримкою, а коли спроби скінчилися, dead-letter). `PermanentQueueError` одразу веде в dead-letter. Доставка **at-least-once**, тому обробники ідемпотентні.

## Топологія RabbitMQ (для черги `q`)

```
publish ──> exchange "nook" (direct, key = q) ──> q ──> consumer (prefetch N)
                                                  │        │
                              nack(requeue=false) │        │ помилка, спроби лишились:
                              або вичерпано спроб │        │ копія з x-attempt+1 у q.retry.<затримка>
                                                  v        v
                       exchange "nook.dlx" ──> q.dead     q.retry.<затримка>  (TTL = затримка)
                       (direct, key = q)                       │
                                                               └─ TTL минув, DLX "nook" ──> назад у q
```

- Усе durable, повідомлення `persistent`, публікація чекає підтвердження брокера.
- Черга `q` має `x-dead-letter-exchange=nook.dlx`: усе, що відхилено без повтору (наприклад, не-JSON), потрапляє в `q.dead` саме брокером.
- Затримка повтору це **TTL черги**, а не повідомлення (TTL повідомлення блокується повільнішим на чолі черги). Тому по одній черзі `q.retry.<мс>` на кожну затримку: `5000`, `10000`, `20000`, ... Затримка подвоюється з кожною спробою до `maxRetryDelayMs`.
- Номер спроби йде в заголовку `x-attempt`, причина останньої помилки в `x-error` (видно в `q.dead`).

## Перепідключення і зупинка

- Початкове з'єднання і втрата з'єднання: повтори з backoff 1, 2, 4 ... до 30 с. API стартує і без брокера. Поки його немає, `publish` кидає `QueueUnavailableError` (планувальник просто повторить за хвилину, ендпоінт відповість `503`).
- Після нового з'єднання драйвер заново оголошує топологію і підписує всіх споживачів. Канал споживача, що помер сам (брокер видалив чергу), підписується знову.
- Зупинка (`onModuleDestroy`): `cancel` споживачів, очікування обробників, що ще працюють (до 10 с), закриття каналів і з'єднання. Повідомлення, яке не встигли підтвердити, брокер віддасть знову.

## Синхронізація Google

Черга `google-sync`, повідомлення `{ workspaceId, userId }`.

- `POST /api/workspaces/:workspaceId/google-calendar/sync-async`: ті самі права, що в `.../sync` (вхід + членство у воркспейсі, чужий воркспейс `404`). Без підключення Google `409`, брокер недоступний `503`, інакше **`202 { "queued": true }`** одразу. Синхронний `.../sync` працює як раніше.
- **Споживач** (`prefetch: 2`) запускає той самий `GoogleCalendarService.sync`. Якщо людина вже вийшла з воркспейсу, або Google відкликав доступ / підключення зняли (`409`), завдання тихо пропускається (повтор не допоможе). Інші помилки (наприклад, `502` від Google) повторюються: 30, 60, 120, 240 с, далі `google-sync.dead`.
- **Періодично** кожні `GOOGLE_SYNC_EVERY_MINUTES` (30; `0` вимикає; не в тестах і лише якщо налаштований Google) у чергу йде по завданню на кожного, хто підключив Google, і на кожен його воркспейс.

## Змінні середовища

| Змінна                          | Типово | Що робить                                                                        |
| ------------------------------- | ------ | -------------------------------------------------------------------------------- |
| `AMQP_URL`                      | пусто  | `amqp://user:pass@host:5672`; без неї працює `InMemoryQueue`                     |
| `GOOGLE_SYNC_EVERY_MINUTES`     | `30`   | періодична фонова синхронізація; `0` вимикає                                     |
| `RABBITMQ_PASSWORD` (лише prod) | пусто  | пароль користувача `nook` у брокері; якщо порожній, береться `POSTGRES_PASSWORD` |

У `docker-compose.yml` і `compose.prod.yml` є сервіс `rabbitmq` (`rabbitmq:4-alpine`, healthcheck `rabbitmq-diagnostics -q ping`, том `rabbitmq-data`, фіксований `hostname`, інакше чергу не знайдуть після перестворення контейнера). API залежить від нього (`service_healthy`). У prod брокер не публікує портів і не має веб-інтерфейсу; у dev AMQP доступний на `localhost:5673`. Пароль застосовується лише під час створення тому.

## Як подивитися на черги

- `GET /api/queue-status` (лише платформенні адміни, `ADMIN_EMAILS`): драйвер, `connected` і по кожній черзі `messages` (готові до доставки), `consumers`, `retrying` (чекають затримки), `dead`. Якщо драйвер не знає (брокер лежить), значення `null`.

  ```json
  {
    "driver": "rabbitmq",
    "connected": true,
    "queues": [{ "name": "google-sync", "messages": 0, "consumers": 2, "retrying": 1, "dead": 0 }]
  }
  ```

- У контейнері: `docker compose -f infra/docker-compose.yml exec rabbitmq rabbitmqctl list_queues name messages consumers`.
- Подивитися dead-letter: у `rabbitmq:4-management-alpine` (локально) у Queues → `google-sync.dead` → Get messages; заголовки `x-error` і `x-attempt` пояснюють, чому повідомлення там. Повернути в роботу можна shovel-ом або повторною публікацією тіла в основну чергу.
- У логах: `Message <id> of "<черга>" dead-lettered after N attempt(s): <причина>`.

## Тести

- Юніт: `in-memory-queue.spec.ts` (ack, nack → retry → dead-letter, порядок, prefetch, віртуальний годинник), `rabbitmq-queue.spec.ts` (проти підробленого каналу `amqplib`: топологія з DLX і retry-чергами, ack/nack-гілки, перепідключення, перепідписка, graceful shutdown), `reminder.spec.ts`.
- E2E: `apps/api/test/queue.e2e-spec.ts` (`sync-async`, періодичне складання завдань, доступ до `queue-status`).
- У тестах `InMemoryQueue` працює з ручним годинником: повтори не мають реальних таймерів, а тест керує часом через `flush()`, `advance(мс)` і `drain()`.
- Драйвер RabbitMQ окремо перевірено вручну проти `rabbitmq:4-management-alpine`: публікація, споживання, повтор із затримкою, dead-letter і відновлення після `docker restart`.
