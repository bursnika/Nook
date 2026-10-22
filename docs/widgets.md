# Віджети й PWA

Nook можна поставити як застосунок на телефон і ноутбук, а план на сьогодні показувати на головному екрані.

## 1. PWA

Веб-застосунок (`/app/`) має `manifest.webmanifest` і service worker. Відкрийте його в Chrome чи Safari й оберіть «Встановити» (Chrome) або «На початковий екран» (Safari на iOS). На Mac у Chrome: меню → «Зберегти й поділитися» → «Встановити Nook», тоді він з'явиться в Dock як окремий застосунок.

## 2. Токен і endpoint

Віджети не вміють входити через Google, тому в Settings → Widgets створюється **особистий токен** (`nkw_…`). Його видно лише одразу після створення, на сервері лежить тільки хеш. Новий токен замінює старий, а «Revoke» вимикає віджети.

```
GET /api/widget/today
Authorization: Bearer nkw_…        (або ?token=nkw_… для інструментів без заголовків)
```

Відповідь: `{ date, generatedAt, counts, tasks:[{title, priority, dueAt, overdue, workspace}], events:[{title, startsAt, endsAt, allDay, workspace}] }`. Це відкриті задачі з дедлайном до кінця сьогодні (прострочені теж) і події сьогодні з усіх воркспейсів людини. Час у UTC, віджет показує його в місцевому поясі.

Токен дає доступ лише до цього читання: ним не можна ні змінювати дані, ні відкрити решту API.

## 3. iPhone: Scriptable

1. Встановіть [Scriptable](https://scriptable.app).
2. Створіть скрипт із вмістом [`widgets/scriptable/nook-today.js`](../widgets/scriptable/nook-today.js), впишіть `BASE` і `TOKEN`.
3. Додайте віджет Scriptable на екран і виберіть цей скрипт. Розміри small, medium, large підтримуються.

## 4. Android: KWGT

У KWGT створіть віджет з текстом і формулою, яка бере JSON:

```
$wg("https://YOUR-DOMAIN/api/widget/today?token=nkw_...", json, ".tasks[0].title")$
```

`.tasks[0].title`, `.tasks[1].title`, `.events[0].title` і `.counts.tasks` дають окремі рядки. Оновлення задайте раз на 15 хвилин.

## 5. Mac: Übersicht

Скопіюйте папку [`widgets/ubersicht/nook-today.widget`](../widgets/ubersicht/nook-today.widget) у `~/Library/Application Support/Übersicht/widgets/`, впишіть `BASE` і `TOKEN`. Віджет оновлюється раз на 5 хвилин.

## Далі

Нативні віджети WidgetKit (iOS) і Glance (Android) можна зробити пізніше: вони читають той самий endpoint.
