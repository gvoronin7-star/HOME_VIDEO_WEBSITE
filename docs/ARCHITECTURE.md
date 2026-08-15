# Архитектура системы

## Общая архитектура

Family Cinema — это клиент-серверное веб-приложение с REST API.

```
┌─────────────┐     ┌─────────────────────────────────────────┐
│   Browser    │     │          Backend API (Express)          │
│   React SPA  │────▶│  ┌──────────┐  ┌──────────────────┐    │
│              │     │  │ Routes   │  │  Controllers     │    │
│  - Auth      │HTTP  │  │ Middleware│─▶│  - Story Logic  │    │
│  - UI        │     │  └──────────┘  │  - Template Mgmt│    │
│  - Player    │     └────────────────┤  - Share Mgmt   │    │
│              │                      └────────┬─────────┘    │
│              │                               │              │
│              │                      ┌────────▼─────────┐    │
│              │                      │    Services      │    │
│              │                      │  - AI (OpenAI)   │    │
│              │                      │  - TTS           │    │
│              │                      │  - Render (FF)   │    │
│              │                      │  - Storage       │    │
│              │                      │  - PDF           │    │
│              │                      │  - QR            │    │
│              │                      └────────┬─────────┘    │
│              │                               │              │
└──────────────┘                               ├──────────────┤
                                               │  Models      │
                                               │  (Sequelize) │
                                               └──────┬───────┘
                                                      │
                                    ┌─────────────────┼─────────────────┬──────────────┐
                                    │                 │                 │              │
                            ┌───────▼───────┐ ┌──────▼──────┐ ┌──────▼──────┐ ┌───────▼───────┐
                            │   SQLite /    │ │  Local FS   │ │  OpenAI API │ │  Redis        │
                            │   PostgreSQL  │ │  (uploads)  │ │  (GPT-4o)   │ │  (BullMQ job) │
                            └───────────────┘ └─────────────┘ └─────────────┘ └───────┬───────┘
                                                                                       │ jobs
                                                                              ┌────────▼────────┐
                                                                              │  Worker process   │
                                                                              │  (own Docker      │
                                                                              │  container / own  │
                                                                              │  OS process)      │
                                                                              │  runs the same    │
                                                                              │  Services above:  │
                                                                              │  AI → TTS →       │
                                                                              │  Render → QR/PDF  │
                                                                              └───────────────────┘
```

The API process and the worker process are two separate deployables sharing one codebase — the API
image also builds the worker's entry point, but `server.ts` never starts it. This is deliberate:
FFmpeg rendering is minutes of CPU time, and sharing a process with request handling used to mean the
render pipeline competed with HTTP traffic. See "Потоки данных" below for the two distinct request
paths that follow from this split.

---

## Потоки данных

### 1. Создание истории (в процессе API, без очереди)

`POST /api/stories` сохраняет фото и создаёт запись целиком синхронно, а генерацию сценария
запускает как fire-and-forget промис **в самом процессе API** — ответ уходит клиенту раньше, чем
сценарий готов. Поэтому история приходит клиенту как `draft` и переходит в `script_ready` через
несколько секунд; фронтенд поэтому опрашивает и `draft`, и рабочие статусы. Это единственный
шаг конвейера, который не проходит через очередь — озвучка, рендер видео, QR и PDF в этот вызов
не входят.

```
Frontend                    Backend (API)                Services
   │                           │                           │
   │  POST /stories            │                           │
   │  (multipart/form-data)   │                           │
   │────────────────────────▶│                           │
   │                           │                           │
   │                           │── sharp ────────────────▶│ Оптимизация фото (потоково, через disk storage)
   │                           │                           │
   │                           │── storage.saveFile ─────▶│ Сохранение фото
   │                           │                           │
   │                           │── Story.create           │ Создание записи (status: draft)
   │                           │                           │
   │                           │── StorySlide.create      │ Создание слайдов
   │                           │                           │
   │  201 { story: draft }     │                           │
   │◀────────────────────────│                           │
   │                           │                           │
   │                           │  (fire-and-forget promise, тот же процесс)
   │                           │                           │
   │                           │── aiService.generateScript(images) ─▶│ Сценарий по реальным фото (data URI)
   │                           │                           │
   │                           │── Story.update           │ status → script_ready
```

### 2. Полная генерация (через очередь BullMQ и отдельный воркер)

`POST /api/stories/:id/generate` — единственный путь, запускающий весь конвейер: озвучку, рендер
FFmpeg, QR и PDF. Он создаёт запись `Task` и ставит задачу в очередь; обрабатывает её отдельный
процесс воркера (`docker-compose.yml`, сервис `worker`), не API.

```
Frontend               Backend (API)            Redis/BullMQ          Worker (свой процесс)
   │                        │                        │                        │
   │  POST /:id/generate    │                        │                        │
   │───────────────────────▶│                        │                        │
   │                        │── Task.create           │                        │
   │                        │── queue.add ───────────▶│                        │
   │  202 { task }          │                        │── job ────────────────▶│
   │◀───────────────────────│                        │                        │
   │                        │                        │                        │── aiService (если scriptText ещё пуст)
   │                        │                        │                        │── ttsService.synthesizeSlides
   │                        │                        │                        │── renderService.renderVideo (FFmpeg)
   │                        │                        │                        │── qrService.generateQRCode
   │                        │                        │                        │── pdfService.generatePDFAlbum
   │                        │                        │                        │── Task.update (progress 5→10→30→40→80→85→100)
   │                        │                        │                        │── Story.update (status: ready)
```

Шаг сценария в воркере вызывает LLM только если `story.scriptText` ещё пусто — история, дошедшая
до `generate` уже с `script_ready`, получила его либо из фонового прохода при создании, либо из
правок пользователя через `PUT /slides`; безусловная регенерация раньше молча затирала и то, и
другое.

### 3. Мониторинг статуса

```
Frontend              Backend              Database
   │                     │                    │
   │  GET /stories/:id/  │                    │
   │  /status            │                    │
   │────────────────────▶│                    │
   │                     │── Story.findByPk   │
   │                     │                    │
   │  { status: '...' }  │                    │
   │◀────────────────────│                    │
   │                     │                    │
   │  (poll every 3s)    │                    │
   │                     │                    │
   │  GET /stories/:id/  │                    │
   │  /status            │                    │
   │────────────────────▶│                    │
   │                     │                    │
   │  { status: 'ready' }│                    │
   │◀────────────────────│                    │
```

### 4. Публичный просмотр

Ключ поиска — отдельный `shareToken` (UUID), а не `id` истории: так публичную ссылку можно
отозвать (`DELETE /share`) или перевыпустить (`POST /share/rotate`), не ломая внешние ключи,
указывающие на историю.

```
Browser (any user)      Backend              Database
      │                     │                    │
      │  GET /share/:token  │                    │
      │────────────────────▶│                    │
      │                     │── Story.findOne    │
      │                     │  (shareToken, status='ready') │
      │                     │                    │
      │  { story: {...} }   │                    │
      │◀────────────────────│                    │
```

---

## Модель данных (ER-диаграмма)

```
┌──────────────┐       ┌──────────────┐
│    User      │       │  Template    │
├──────────────┤       ├──────────────┤
│ id (PK)      │       │ id (PK)      │
│ email (UQ)   │       │ name         │
│ passwordHash │       │ description  │
│ name         │       │ tone         │
│ createdAt    │       │ defaultDur   │
│ updatedAt    │       │ promptTemp   │
└──────┬───────┘       └──────────────┘
       │
       │ userId (FK)
       │
       ▼
┌──────────────┐       ┌──────────────────┐
│    Story     │       │   StorySlide     │
├──────────────┤       ├──────────────────┤
│ id (PK)      │◀──────│ storyId (FK)     │
│ userId (FK)  │       ├──────────────────┤
│ templateId   │       │ id (PK)          │
│ title        │       │ imageUrl         │
│ status       │       │ imageKey         │
│ tone         │       │ orderIndex       │
│ voiceGender  │       │ caption          │
│ scriptText   │       │ durationSeconds  │
│ videoUrl     │       │ isKeyFrame       │
│ pdfUrl       │       │ createdAt        │
│ qrCodeUrl    │       └──────────────────┘
│ publicUrl    │
│ shareToken   │
│ createdAt    │
│ updatedAt    │
└──────────────┘

┌──────────────┐       ┌──────────────────┐
│    Task      │       │  VoiceProfile    │
├──────────────┤       ├──────────────────┤
│ id (PK)      │       │ id (PK)          │
│ storyId (FK) │       │ name             │
│ type         │       │ gender           │
│ status       │       │ emotion          │
│ errorMessage │       │ apiVoiceId       │
│ progress     │       │ previewUrl       │
│ resultData   │       │ createdAt        │
│ createdAt    │       │ updatedAt        │
│ completedAt  │       └──────────────────┘
└──────────────┘
```

### Статусы Story

```
draft ──▶ script_generating ──▶ script_ready ──▶ rendering ──▶ ready
  │              │                                       │
  │              └── error ◀─────────────────────────────┘
  │
  └── generate (manual) ──▶ script_generating
```

### Типы задач Task

- `generate_script` — генерация сценария через LLM
- `generate_tts` — синтез речи
- `render_video` — мозаика видео через FFmpeg
- `generate_pdf` — создание PDF-альбома
- `generate_qr` — генерация QR-кода

---

## Сервисы

### AI Service (`ai.service.ts`)

Генерация сценариев через OpenAI GPT.

**Рабочий процесс:**
1. Для каждого слайда читаются реальные байты фото и кодируются в base64 data URI
   (`utils/imageDataUri.ts`)
2. Формирование сообщения модели: текстовые блоки чередуются с `image_url`-блоками фото
   (`detail: 'low'` — достаточно для описания сцены/настроения, но заметно дешевле по токенам,
   чем `'auto'`, который может взять полное разрешение)
3. Вызов OpenAI Chat Completions API (vision-режим)
4. Парсинг JSON-ответа
5. Fallback на mock-генерацию при ошибке или отсутствии `OPENAI_API_KEY`

**Fallback:**
Если OpenAI недоступен, ключ не задан или исчерпан бюджет повторов, используется mock-режим с
шаблонными фразами. Mock-режим фото не видит вообще — у него есть только индекс кадра и признак
ключевого кадра, поэтому его подписи намеренно общие, а не описывают содержимое снимка.

Оба пути генерации (фоновый вызов при создании истории и первый шаг воркера) вызывают
`aiService.generateScript()` независимо друг от друга, каждый собирая свой массив `images` из
текущих слайдов истории.

### TTS Service (`tts.service.ts`)

Синтез речи из текста — одна реплика на слайд, через OpenAI-совместимый API.

**Поддерживаемые режимы (`TTS_SERVICE`):**
- `openai` — реальный синтез через `OPENAI_BASE_URL` (официальный OpenAI или ProxyAPI-совместимый
  endpoint); голос подбирается по `VoiceProfile`
- `none` / любое другое значение — намеренно беззвучная дорожка

**Особенности:**
- Длительность каждой реплики измеряется через `ffprobe` и записывается обратно в
  `StorySlide.durationSeconds`; ручная длительность слайда действует как нижняя граница
  (`max(длительность_озвучки + 0.4с, 2с, durationSeconds)`), поэтому обрезать уже озвученную
  реплику невозможно
- Если `ffprobe` недоступен, длительность оценивается по количеству символов, а уже
  synthesized-аудио не отбрасывается

### Render Service (`render.service.ts`)

Мозаика видео через FFmpeg.

**Этапы:**
1. Создание временной директории
2. Для каждого слайда:
   - Масштабирование изображения до 1920x1080
   - Наложение текста (drawtext)
   - Создание короткого видео (loop + duration)
3. Создание concat-файла
4. Объединение слайдов в одно видео
5. Наложение аудиодорожки (если есть)
6. Кодирование в MP4 (libx264, AAC)
7. Удаление временных файлов

**Параметры FFmpeg:**
- Видео: libx264, preset=medium, CRF=23, 30fps
- Аудио: AAC, 128kbps
- Размер: 1920x1080 (Full HD)

### Storage Service (`storage.service.ts`)

Управление файлами.

**Категории:**
- `photos` — исходные фотографии
- `videos` — готовые видео
- `pdfs` — PDF-альбомы
- `qrcodes` — QR-коды
- `audio` — аудиофайлы TTS
- `temp` — временные файлы

**Поддерживаемые бэкенды:**
- `local` (default) — локальная файловая система
- `s3` — TODO: S3-совместимое хранилище

### PDF Service (`pdf.service.ts`)

Генерация PDF-альбома.

**Состав:**
- Обложка с названием
- Страницы с фото и текстом
- QR-код на обложке или последней странице

### QR Service (`qr.service.ts`)

Генерация QR-кодов.

**Поддерживаемые форматы:**
- PNG (для хранения и вставки в PDF)
- SVG (для отображения на клиенте)

---

## Middleware

### Auth Middleware

Проверка JWT-токена.

**Последовательность:**
1. Извлечение токена — сначала заголовок `Authorization: Bearer <token>`, если его нет — из
   httpOnly-cookie (`utils/authCookie.ts`); заголовок имеет приоритет, если присутствуют оба
2. Верификация токена через `jwt.verify()`
3. Загрузка пользователя из БД
4. Добавление `req.user` в запрос

**Обработка ошибок:**
- `TokenExpiredError` → 401 "Токен истёк"
- Другие ошибки → 401 "Недействительный токен"

### Validate Middleware

Валидация входных данных через Zod.

**Пример схемы:**
```typescript
const registerSchema = z.object({
  body: z.object({
    email: z.string().email(),
    password: z.string().min(6),
    name: z.string().optional(),
  }),
});
```

### Upload Middleware

Загрузка файлов через Multer.

**Параметры:**
- Потоковая запись на диск во временную папку (`diskStorage`), не буферизация целиком в памяти —
  ограничивает память на запрос, а не только суммарный размер файлов
- Макс. размер: 10 МБ
- Макс. файлов: 20
- Фильтр форматов: JPG, PNG, WebP

### Error Middleware

Центлизованная обработка ошибок.

**Типы ошибок:**
- `AppError` — операционные ошибки (4xx)
- Другие — внутренние ошибки (5xx)

**Логирование:**
- 4xx — не логируются
- 5xx — логируются с stack trace

---

## Безопасность

### Аутентификация
- JWT-токены с истечением 7 дней
- Пароли хэшируются bcrypt
- Токен передаётся httpOnly-cookie (`sameSite: 'lax'`, `secure` зависит от `req.secure`, учитывает
  `trust proxy`) для браузера и заголовком `Authorization: Bearer` для остальных клиентов —
  заголовок приоритетнее, если присутствуют оба; JS не может прочитать или очистить cookie сам,
  поэтому есть `POST /api/auth/logout`

### Валидация
- Zod-схемы на все входные данные
- Проверка типов и ограничений
- Санитизация строк

### HTTP
- `helmet` — security-заголовки и CSP
- Rate limiting на регистрацию/логин отдельно от остальных маршрутов
- CORS: белый список доменов, `credentials: true`, ограниченные методы и заголовки

### Публичные ссылки
- Share-ссылка ключуется отдельным `shareToken` (UUID), а не `id` истории
- Ссылку можно перевыпустить (`POST /share/rotate`, старая перестаёт работать) или отозвать
  (`DELETE /share`)

### FFmpeg
- Аргументы передаются массивом в `spawn` с `shell: false` — командная строка никогда не собирается
- Подпись слайда попадает в `drawtext` только через файл (`textfile=...`), никогда не в argv или
  в filtergraph — так пользовательский текст (`PUT /slides`) не может быть интерпретирован как
  часть команды

### Файлы
- Проверка MIME-типов
- Ограничение размера
- Оптимизация изображений (sharp)
- Загрузка — потоковая запись на диск (`diskStorage`), не буферизация в памяти
- Автоматическая очистка файлов историй старше `FILE_RETENTION_DAYS` (целиком со строкой БД, не
  только файлов) и отдельная очистка `uploads/temp`

### Логирование
- Маскирование чувствительных данных (JWT, пароли)
- Уровень логирования зависит от NODE_ENV
- Структурированные логи (Pino)

---

## Масштабирование

### Текущие ограничения
- Файлы хранятся локально (нет S3/облачного хранилища)
- Нет кэширования шаблонов и сценариев
- Прогресс генерации доступен только через поллинг `GET /stories/:id/status`, нет WebSockets/SSE

### Планы масштабирования
1. **S3-хранилище** для файлов
2. **Кэширование** шаблонов и сценариев
3. **WebSockets** для real-time статусов
4. **CDN** для статики и медиа
5. **Load balancer** и несколько инстансов воркера/бэкенда

---

## Развёртывание

Docker Compose уже реализован — `docker-compose.yml` в корне репозитория, многоступенчатые
`Dockerfile` в `backend/` и `frontend/`. Шесть сервисов: `postgres`, `redis`, `init` (одноразовый
`migrate` + `seed`, `backend` дожидается его через `service_completed_successfully`), `backend`,
`worker`, `frontend` (nginx). Запуск:

```bash
JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))") docker compose up --build
```

### Production Checklist

- [ ] `NODE_ENV=production`
- [ ] Сильный `JWT_SECRET`
- [ ] PostgreSQL вместо SQLite
- [x] Redis + BullMQ для очередей, отдельный процесс воркера
- [ ] S3 для файлов
- [ ] HTTPS (терминируется на обратном прокси, сервис сам её не обслуживает)
- [ ] Reverse proxy (Nginx) перед бэкендом — во фронтенд-образе Nginx уже раздаёт статику
- [ ] Process manager (PM2) — в Docker роль планировщика перезапуска берёт на себя `restart` политика/оркестратор
- [ ] Мониторинг и алерты
- [ ] Бэкапы БД
- [x] CI/CD пайплайн — `.github/workflows/ci.yml`: типы/линт/сборка/тесты для обоих пакетов, сборка
      Docker-образов, smoke-тест через `docker compose` с рендером настоящего видео
