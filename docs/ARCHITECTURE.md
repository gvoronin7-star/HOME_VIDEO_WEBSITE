# Архитектура системы

## Общая архитектура

Family Cinema — это клиент-серверное веб-приложение с REST API.

```
┌─────────────┐     ┌─────────────────────────────────────────┐
│   Browser    │     │            Backend (Express)            │
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
                                    ┌─────────────────┼─────────────────┐
                                    │                 │                 │
                            ┌───────▼───────┐ ┌──────▼──────┐ ┌──────▼──────┐
                            │   SQLite /    │ │  Local FS   │ │  OpenAI API │
                            │   PostgreSQL  │ │  (uploads)  │ │  (GPT-4o)   │
                            └───────────────┘ └─────────────┘ └─────────────┘
```

---

## Потоки данных

### 1. Создание истории

```
Frontend                    Backend                     Services
   │                           │                           │
   │  POST /stories            │                           │
   │  (multipart/form-data)   │                           │
   │────────────────────────▶│                           │
   │                           │                           │
   │                           │── sharp ────────────────▶│ Оптимизация фото
   │                           │                           │
   │                           │── storage.saveFile ─────▶│ Сохранение фото
   │                           │                           │
   │                           │── Story.create           │ Создание записи
   │                           │                           │
   │                           │── StorySlide.create      │ Создание слайдов
   │                           │                           │
   │  201 { story }            │                           │
   │◀────────────────────────│                           │
   │                           │                           │
   │                           │  (async)                  │
   │                           │                           │
   │                           │── generateScript         │
   │                           │                           │
   │                           │                           │── OpenAI ──▶│ Генерация сценария
   │                           │                           │              │
   │                           │── Story.update           │ Сохранение сценария
   │                           │                           │
   │                           │── ttsService.synthesize  │ Синтез речи
   │                           │                           │
   │                           │── renderService.render   │ Мозаика видео
   │                           │                           │
   │                           │── qrService.generate     │ QR-код
   │                           │                           │
   │                           │── pdfService.generate    │ PDF-альбом
   │                           │                           │
   │                           │── Story.update           │ Обновление статусов
```

### 2. Мониторинг статуса

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

### 3. Публичный просмотр

```
Browser (any user)      Backend              Database
      │                     │                    │
      │  GET /share/:id     │                    │
      │────────────────────▶│                    │
      │                     │── Story.findOne    │
      │                     │  (status='ready')  │
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
1. Формирование промпта с описанием кадров, шаблона и тона
2. Вызов OpenAI Chat Completions API
3. Парсинг JSON-ответа
4. Fallback на mock-генерацию при ошибке

**Fallback:**
Если OpenAI недоступен или возникает ошибка, используется mock-режим с шаблонными фразами.

### TTS Service (`tts.service.ts`)

Синтез речи из текста.

**Поддерживаемые сервисы:**
- `browser` (default) — заглушка (генерирует тишину)
- `azure` — TODO: Azure Speech SDK
- `yandex` — TODO: Yandex SpeechKit (планируется)

**Планируется:**
- Интеграция с реальными TTS-сервисами
- Разбиение текста на чанки (max 5000 символов)
- Поддержка разных голосов и эмоций

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
1. Извлечение заголовка `Authorization: Bearer <token>`
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
- Хранение в памяти (memoryStorage)
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
- Токены хранятся в localStorage на клиенте

### Валидация
- Zod-схемы на все входные данные
- Проверка типов и ограничений
- Санитизация строк

### CORS
- Белый список доменов
- Credentials: true
- Ограниченные методы и заголовки

### Файлы
- Проверка MIME-типов
- Ограничение размера
- Оптимизация изображений (sharp)
- Автоматическая очистка старых файлов

### Логирование
- Маскирование чувствительных данных (JWT, пароли)
- Уровень логирования зависит от NODE_ENV
- Структурированные логи (Pino)

---

## Масштабирование

### Текущие ограничения
- FFmpeg выполняется синхронно (блокирует event loop)
- Файлы хранятся локально
- Нет очередей задач
- Нет кэширования

### Планы масштабирования
1. **Worker-процессы** для FFmpeg
2. **Redis + BullMQ** для очередей
3. **S3-хранилище** для файлов
4. **Кэширование** шаблонов и сценариев
5. **WebSockets** для real-time статусов
6. **CDN** для статики и медиа
7. **Load balancer** для нескольких инстансов бэкенда

---

## Развёртывание

### Production Checklist

- [ ] `NODE_ENV=production`
- [ ] Сильный `JWT_SECRET`
- [ ] PostgreSQL вместо SQLite
- [ ] Redis для очередей
- [ ] S3 для файлов
- [ ] HTTPS
- [ ] Reverse proxy (Nginx)
- [ ] Process manager (PM2)
- [ ] Мониторинг и алерты
- [ ] Бэкапы БД
- [ ] CI/CD пайплайн

### Docker (планируется)

```dockerfile
# Backend
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY dist ./dist
CMD ["node", "dist/server.js"]

# Frontend
FROM nginx:alpine
COPY dist /usr/share/nginx/html
```
