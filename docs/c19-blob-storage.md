# C19. Файли в Azure Blob Storage

Завантажені файли (вкладення, обкладинки сторінок) лежать за інтерфейсом `FileStorage`. Драйвер обирається змінними середовища:

| Драйвер            | Коли                                     | Де лежать файли                  |
| ------------------ | ---------------------------------------- | -------------------------------- |
| `LocalDiskStorage` | типово (змінної Azure немає)             | папка `UPLOAD_DIR` (том Docker)  |
| `AzureBlobStorage` | задано `AZURE_STORAGE_CONNECTION_STRING` | приватний контейнер Blob Storage |

Поведінка для користувача не змінюється: в базі зберігається `url = /uploads/<uuid>.<ext>`, файл віддається за цією адресою, ті самі обмеження (10 МБ, лише PNG/JPEG/GIF/WebP/PDF/TXT/MD, без SVG і HTML).

## Змінні середовища

| Змінна                            | Типово         | Призначення                                                        |
| --------------------------------- | -------------- | ------------------------------------------------------------------ |
| `AZURE_STORAGE_CONNECTION_STRING` | (порожньо)     | рядок підключення акаунта; порожньо = локальний диск               |
| `AZURE_STORAGE_CONTAINER`         | `nook-uploads` | назва контейнера; створюється при першому запуску, якщо його немає |
| `UPLOAD_DIR`                      | `uploads`      | папка локального драйвера (з Azure не використовується)            |

Рядок підключення це секрет: тримайте його лише в `.env` на сервері й у `apps/api/.env`, не комітьте.

## Як це влаштовано

```
multer ──файл──► FileStorageEngine ──put(stream)──► FileStorage ┬─ LocalDiskStorage  (диск)
                                                                └─ AzureBlobStorage  (uploadStream у контейнер)
GET /uploads/<name> ──► статика (локально) або open(name) → потік (Azure)
```

- `FileStorage`: `put({ name, data: Buffer | Readable, contentType }) → { name, url, size }`, `delete(urlOrName)`, `open(name) → { stream, size } | null`, `urlFor(name)`.
- Multer не пише на диск сам: `FileStorageEngine` передає потік файлу прямо в `put` (без тимчасових файлів і без буферизації всього файла в пам'яті). Якщо запит відхилено вже після завантаження (неправильний `pageId`, перевищено ліміт), файл забирається назад через `delete`, тож сиріт немає.
- Ім'я в сховищі випадкове (`uuid` + розширення за перевіреним MIME), клієнтське ім'я лише зберігається в БД як `filename`.

### Чому через API, а не SAS-посилання

Обрано **приватні блоби, які API віддає потоком** за адресою `/uploads/<name>`:

- блоби не публічні: прямий URL блоба повертає помилку, браузер взагалі не звертається до акаунта сховища;
- ті самі захисні заголовки, що й у локальних файлів: `X-Content-Type-Options: nosniff` і `Content-Security-Policy: sandbox; default-src 'none'; img-src 'self'`; `Content-Type` береться з розширення імені, яке ми самі й видали, а не з метаданих блоба;
- адреса в БД (`/uploads/...`) однакова для обох драйверів і не спливає: з SAS-токенами довелося б або зберігати посилання, що протухають, або підписувати їх при кожному читанні списку, а `coverUrl` перевіряється як `/uploads/...`;
- переїзд з диска в Azure не потребує міграції даних (див. нижче).

Ціна: трафік файлів іде через API. Для навчального обсягу це прийнятно; для великого перейшли б на короткоживучі read-SAS з редіректом `302` з `/uploads/<name>` (адреса в БД лишилась би тією самою).

Відповідь `/uploads/<name>`: `404`, якщо імені немає в сховищі або воно не схоже на згенероване (`<uuid>.<ext>`; до сховища такі запити навіть не доходять), `502`, якщо сховище недоступне.

## Налаштування в Azure for Students

Портал:

1. **Create a resource → Storage account.** Resource group: `nook-rg` (або наявна, з якої керується ВМ). Назва: 3–24 символи, малі літери й цифри, унікальна глобально, наприклад `nookvero2026`. Region: та сама, що в ВМ. Performance: **Standard**, Redundancy: **LRS** (найдешевше).
2. Вкладка **Advanced**: **Allow enabling anonymous access on individual containers: вимкнено**, Minimum TLS 1.2.
3. Після створення: **Data storage → Containers → + Container**, назва `nook-uploads`, **Public access level: Private (no anonymous access)**. (Цей крок необов'язковий: API створить приватний контейнер сам.)
4. **Security + networking → Access keys → Show → Connection string** (key1). Скопіюйте.

CLI (еквівалент):

```bash
az group create -n nook-rg -l westeurope
az storage account create -n nookvero2026 -g nook-rg -l westeurope \
  --sku Standard_LRS --kind StorageV2 --allow-blob-public-access false --min-tls-version TLS1_2
az storage account show-connection-string -n nookvero2026 -g nook-rg --query connectionString -o tsv
```

На сервері додайте в `~/nook/.env` (`compose.prod.yml` уже передає ці змінні в `api`):

```bash
AZURE_STORAGE_CONNECTION_STRING=<рядок підключення>
AZURE_STORAGE_CONTAINER=nook-uploads
```

і перезапустіть: `docker compose up -d api`. У логах при старті жодних попереджень про контейнер бути не повинно.

Локально: ті самі два рядки в `apps/api/.env`. Для розробки без акаунта можна використати емулятор Azurite (`docker run -p 10000:10000 mcr.microsoft.com/azure-storage/azurite azurite-blob --blobHost 0.0.0.0`) з рядком підключення з документації Azurite (`UseDevelopmentStorage=true`).

### Перенесення наявних файлів

Імена файлів у БД не змінюються, тому достатньо скопіювати вміст тому в контейнер:

```bash
docker compose cp api:/data/uploads ./uploads-backup
az storage blob upload-batch --account-name nookvero2026 -d nook-uploads -s ./uploads-backup \
  --connection-string "$AZURE_STORAGE_CONNECTION_STRING"
```

## Як перевірити

1. Завантажте файл: адмінка `/admin/workspaces/<id>/attachments/new` або `POST /api/workspaces/<id>/attachments` (multipart, поле `file`). У відповіді `url` виду `/uploads/<uuid>.png`.
2. У порталі Azure, контейнер `nook-uploads`, має з'явитися блоб з цим іменем (Content-Type як у файла).
3. Заголовки:

   ```bash
   curl -sI https://<домен>/uploads/<uuid>.png
   # HTTP/2 200
   # content-type: image/png
   # x-content-type-options: nosniff
   # content-security-policy: sandbox; default-src 'none'; img-src 'self'
   ```

4. Блоб справді приватний:

   ```bash
   curl -sI "https://nookvero2026.blob.core.windows.net/nook-uploads/<uuid>.png"
   # HTTP/1.1 404 (або 409 PublicAccessNotPermitted): без ключа не читається
   ```

5. Видаліть вкладення в адмінці: блоб зникає з контейнера (`az storage blob list ...`).
6. Локальна папка `UPLOAD_DIR` при цьому лишається порожньою.

## Тести

Без зовнішніх сервісів:

- `src/uploads/azure-blob-storage.spec.ts`: драйвер Azure проти підставного клієнта (завантаження потоком і буфером, `Content-Type`, розмір, створення контейнера один раз і повтор після помилки, `open` → потік/`null`/пробрасування не-404, `delete` за ім'ям і за url, ігнорування зовнішніх посилань і збоїв видалення).
- `src/uploads/local-disk-storage.spec.ts`: локальний драйвер (папка створюється на льоту, прибирання недописаного файла, захист від виходу за межі папки).
- `test/storage.e2e-spec.ts`: застосунок із підставним сховищем без локальної папки (так само, як Azure): завантаження вкладення й обкладинки з адмінки йде через `put`, файл віддається потоком із заголовками `nosniff` і CSP `sandbox`, `404` для чужих імен, `502` при недоступному сховищі, видалення запису видаляє файл, відхилений запит не лишає сироту.
