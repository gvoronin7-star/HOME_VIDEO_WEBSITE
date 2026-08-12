# Family Cinema

**AI-сервис генерации семейных видеоисторий**

Family Cinema — веб-приложение для создания трогательных видеоисторий из семейных фотографий с помощью искусственного интеллекта. Пользователь загружает фотографии, выбирает шаблон и тон повествования, а система автоматически генерирует сценарий, озвучку, видео, QR-код и PDF-альбом.

## 📋 Содержание

- [Возможности](#-возможности)
- [Архитектура](#-архитектура)
- [Технологический стек](#-технологический-стек)
- [Быстрый старт](#-быстрый-старт)
- [Развёртывание](#-развёртывание)
- [API Reference](#-api-reference)
- [Структура проекта](#-структура-проекта)
- [Модели данных](#-модели-данных)
- [Конфигурация](#-конфигурация)
- [Разработка](#-разработка)
- [FAQ](#-faq)

---

## ✨ Возможности

- **Регистрация и авторизация** — JWT-аутентификация, страницы проверяют вход и перенаправляют на `/login`
- **Загрузка фотографий** — от 1 до 20 изображений с оптимизацией через Sharp и индикатором прогресса
- **Шаблоны историй** — набор тематических шаблонов с разными тонами повествования
- **AI-сценарий** — генерация текста через OpenAI-совместимый API на основе шаблона и тона
- **Озвучка (TTS)** — синтез речи через OpenAI-совместимый API (`audio/speech`), отдельная фраза
  на кадр; длительность кадра подстраивается под длительность фразы
- **Редактирование сценария** — правка текста, порядка и минимальной длительности кадров
- **Генерация видео** — FFmpeg: слайд-шоу 1920×1080, 30 fps, текст на кадрах, звуковая дорожка
- **Быстрое превью** — первые 4 кадра без озвучки, чтобы не ждать полный рендер
- **QR-код** — для быстрого доступа к истории
- **PDF-альбом** — печатная версия истории с фото и текстом
- **Общий доступ** — публичная страница истории по ссылке
- **Асинхронная обработка** — очередь задач на BullMQ + Redis с повторами
- **Прогресс генерации** — опрос статуса с реальными процентами и названием текущего шага

### Тесты и CI

82 интеграционных и модульных теста на Vitest + Supertest. Прогон:

```bash
npm test
```

Покрывают то, что уже ломалось: связку роутер → контроллер (`POST /api/stories`), наличие
справочников, валидацию слайдов, инъекцию команд в FFmpeg, отказ очереди без Redis, ограничители
частоты, отказ старта со слабым секретом и на пустой схеме, удаление артефактов, контракт синтеза
речи, обработку ответов LLM, security-заголовки и истечение срока хранения.

Отдельные команды:

```bash
npm run typecheck
```

CI — [`.github/workflows/ci.yml`](.github/workflows/ci.yml), четыре задачи: типы и тесты бэкенда,
типы и сборка фронтенда, **сборка Docker-образов** и smoke-тест через `docker compose`. Сборка
образов вынесена в отдельную задачу не для симметрии: однажды `.dockerignore` исключал каталог
`src`, из-за чего образ фронтенда не собирался вообще, притом что все локальные команды работали.

### Чего пока нет

Список сознательно приведён здесь, чтобы документация не обещала лишнего:

- **музыкальной дорожки и субтитров** — только текст, наложенный на кадры;
- **распознавания речи (STT)** и голосовых комментариев;
- **«календаря воспоминаний»** по EXIF;
- **облачного хранилища** — файлы лежат на локальном диске (`STORAGE_TYPE=s3` в конфигурации
  предусмотрен, но не реализован);
- **версионированных миграций** — схема поднимается шагом инициализации;
- **ESLint и Prettier**, **HTTPS**, **security-заголовков и CSP**.

Актуальное состояние и открытые вопросы: [AUDIT_2026-08-12.md](AUDIT_2026-08-12.md),
[PROPOSALS.md](PROPOSALS.md), [PLAN_4_DAYS.md](PLAN_4_DAYS.md).

> **Важно:** задайте `JWT_SECRET` (минимум 32 символа) — в production сервер иначе откажется
> запускаться. Сгенерировать:
> `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`
>
> Ограничение частоты запросов включено. Пока не сделано: security-заголовки и CSP (**S4**),
> httpOnly-cookie вместо localStorage (**S5**), отзыв публичной ссылки (**S6**).

---

## 🏗 Архитектура

```
┌─────────────────┐         ┌─────────────────┐
│   Frontend      │         │   Backend       │
│   (React + Vite)│         │   (Express +    │
│   :5173         │◄───────►│    TypeScript)  │
└─────────────────┘  HTTP   │   :4000         │
                            └────────┬────────┘
                                     │
              ┌──────────────────────┼──────────────────────┐
              │                      │                      │
    ┌─────────▼────────┐  ┌─────────▼────────┐  ┌─────────▼────────┐
    │  PostgreSQL      │  │     Redis        │  │   Local FS       │
    │  (или SQLite)    │  │  (BullMQ queue)  │  │   (uploads)      │
    └──────────────────┘  └──────────────────┘  └──────────────────┘
```

### Потоки данных

1. **Создание истории**:
   ```
   Загрузка фото → Оптимизация (Sharp) → Сохранение → Создание записи Story
   ```

2. **Генерация видео**:
   ```
   POST /stories/:id/generate
   → Создание Task (status: queued)
   → Добавление в BullMQ очередь
   → Worker: Script (OpenAI) → TTS → Video (FFmpeg) → QR + PDF
   → Обновление Task (status: completed)
   ```

---

## 🛠 Технологический стек

### Backend

| Компонент       | Технология              | Версия  |
|-----------------|-------------------------|---------|
| Язык            | TypeScript              | 5.5+    |
| Фреймворк       | Express.js              | 4.19+   |
| ORM             | Sequelize               | 6.37+   |
| База данных     | PostgreSQL / SQLite     | 15 / 3  |
| Кэш / Очередь   | Redis (BullMQ)          | 7 / 5.1 |
| Аутентификация  | JWT (jsonwebtoken)      | 9.0+    |
| Валидация       | Zod                     | 3.23+   |
| Логирование     | Pino                    | 9.3+    |
| Обработка файлов | Multer, Sharp          | 1.4 / 0.33 |
| Видео           | FFmpeg                  | —       |

### Frontend

| Компонент       | Технология              | Версия  |
|-----------------|-------------------------|---------|
| Язык            | TypeScript              | 5.5+    |
| Фреймворк       | React                   | 18.3+   |
| Сборщик         | Vite                    | 5.4+    |
| Роутинг         | React Router DOM        | 6.26+   |
| HTTP-клиент     | Axios                   | 1.7+    |
| Drag & Drop     | react-beautiful-dnd     | 13.1+   |
| Уведомления     | react-hot-toast         | 2.4+    |
| Загрузка файлов  | react-dropzone          | 14.2+   |

### Инфраструктура

| Компонент       | Технология              |
|-----------------|-------------------------|
| Контейнеризация | Docker + Docker Compose |
| Веб-сервер      | Nginx (для фронтенда)   |
| БД              | PostgreSQL 15 Alpine    |
| Кэш             | Redis 7 Alpine          |

---

## 🚀 Быстрый старт

### Предварительные требования

- **Node.js** 18+ (рекомендуется 20 LTS)
- **npm** 9+ (или yarn/pnpm)
- **FFmpeg** — для генерации видео (опционально)
- **PostgreSQL** 15+ — для продакшена (опционально)
- **Redis** 7+ — для очередей (опционально)

### Установка

```bash
# Клонировать репозиторий
git clone <repository-url>
cd cinem2

# Установить зависимости backend
cd backend
npm install

# Установить зависимости frontend
cd ../frontend
npm install
cd ..
```

### Настройка окружения

```bash
# Скопировать файл конфигурации
cd backend
cp .env.example .env

# Отредактировать .env по необходимости
# Минимальная настройка для запуска:
# DB_DIALECT=sqlite  (по умолчанию, работает без БД)
```

### Запуск в режиме разработки

```bash
# Терминал 1 — Backend
cd backend
npm run dev

# Терминал 2 — Frontend
cd frontend
npm run dev
```

### Открыть приложение

| Сервис    | URL                    |
|-----------|------------------------|
| Frontend  | http://localhost:5173  |
| Backend   | http://localhost:4000  |
| Health    | GET /api/health        |

---

## 🐳 Развёртывание

### Docker Compose (рекомендуется)

```bash
# Поднять все сервисы
docker compose up --build

# В фоновом режиме
docker compose up -d

# Остановить все сервисы
docker compose down

# Остановить и удалить данные
docker compose down -v
```

### Сервисы в Docker Compose

| Сервис    | Образ                   | Порт   | Назначение             |
|-----------|-------------------------|--------|------------------------|
| postgres  | postgres:15-alpine      | 5432   | Основная БД            |
| redis     | redis:7-alpine          | 6379   | BullMQ очередь         |
| backend   | custom (backend/)       | 4000   | API сервер             |
| frontend  | custom (frontend/)      | 3000   | Веб-интерфейс (nginx)  |

### Переменные окружения для Docker

```env
DB_HOST=postgres        # ← имя сервиса в Docker
REDIS_HOST=redis        # ← имя сервиса в Docker
PORT=4000
FRONTEND_PORT=3000
CORS_ORIGIN=http://localhost:5173
```

---

## 📡 API Reference

### Аутентификация

| Метод   | Путь                    | Описание           | Авторизация |
|---------|-------------------------|--------------------|-------------|
| POST    | `/api/auth/register`    | Регистрация        | ❌          |
| POST    | `/api/auth/login`       | Вход               | ❌          |
| GET     | `/api/auth/me`          | Профиль пользователя | ✅        |

**Регистрация** — `POST /api/auth/register`

```json
{
  "email": "user@example.com",
  "password": "secure123",
  "name": "Иван Иванов"
}
```

**Ответ:**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "name": "Иван Иванов"
    },
    "token": "jwt-token-here"
  }
}
```

### Шаблоны

| Метод   | Путь                   | Описание              | Авторизация |
|---------|------------------------|-----------------------|-------------|
| GET     | `/api/templates`       | Список всех шаблонов  | ❌          |
| GET     | `/api/templates/:id`   | Детали шаблона        | ❌          |

### Истории

| Метод    | Путь                          | Описание                | Авторизация |
|----------|-------------------------------|-------------------------|-------------|
| POST     | `/api/stories`                | Создать историю         | ✅          |
| GET      | `/api/stories`                | Мои истории             | ✅          |
| GET      | `/api/stories/:id`            | Детали истории          | ✅          |
| PUT      | `/api/stories/:id/slides`     | Обновить слайды         | ✅          |
| POST     | `/api/stories/:id/generate`   | Запустить генерацию     | ✅          |
| GET      | `/api/stories/:id/status`     | Статус генерации        | ✅          |
| DELETE   | `/api/stories/:id`            | Удалить историю         | ✅          |

**Создание истории** — `POST /api/stories`

```
Content-Type: multipart/form-data

files: [File, File, ...]  // 1-20 изображений
templateId: "uuid"
title: "Моя история"
tone: "warm"
voiceGender: "female"
```

**Запуск генерации** — `POST /api/stories/:id/generate`

```json
// Ответ
{
  "success": true,
  "data": {
    "message": "Генерация поставлена в очередь",
    "storyId": "uuid",
    "taskId": "uuid",
    "status": "queued",
    "jobId": "1"
  }
}
```

**Проверка статуса** — `GET /api/stories/:id/status`

```json
{
  "success": true,
  "data": {
    "story": {
      "id": "uuid",
      "status": "script_generating",
      "videoUrl": null,
      "pdfUrl": null,
      "qrCodeUrl": null,
      "updatedAt": "2026-08-06T12:00:00Z"
    },
    "task": {
      "id": "uuid",
      "status": "processing",
      "progress": 30,
      "errorMessage": null,
      "createdAt": "2026-08-06T12:00:00Z",
      "completedAt": null
    }
  }
}
```

**Статусы Task:**
- `pending` — ожидает обработки
- `queued` — в очереди BullMQ
- `processing` — обрабатывается
- `completed` — завершено
- `failed` — ошибка

**Статусы Story:**
- `draft` — черновик
- `script_generating` — генерация сценария
- `script_ready` — сценарий готов
- `rendering` — рендер видео
- `ready` — готово
- `error` — ошибка

### Общий доступ

| Метод   | Путь                    | Описание              | Авторизация |
|---------|-------------------------|-----------------------|-------------|
| GET     | `/api/share/:id`        | Публичная страница    | ❌          |

### Здоровье системы

| Метод   | Путь           | Описание           | Авторизация |
|---------|----------------|--------------------|-------------|
| GET     | `/api/health`  | Проверка сервиса   | ❌          |

```json
{
  "status": "ok",
  "timestamp": "2026-08-06T12:00:00Z",
  "uptime": 3600,
  "checks": {
    "database": "ok",
    "redis": "ok",
    "ffmpeg": "ok"
  }
}
```

---

## 📁 Структура проекта

```
cinem2/
├── docker-compose.yml          # Оркестрация сервисов
├── .env.example                # Шаблон переменных окружения
├── .gitignore
│
├── backend/                    # Backend (Express + TypeScript)
│   ├── Dockerfile              # Сборка контейнера
│   ├── .dockerignore
│   ├── tsconfig.json
│   ├── package.json
│   ├── .env
│   ├── .env.example
│   └── src/
│       ├── server.ts           # Точка входа
│       ├── app.ts              # Конфигурация Express
│       ├── config/
│       │   └── index.ts        # Централизованная конфигурация
│       ├── models/             # Sequelize модели
│       │   ├── index.ts        # Экспорт + ассоциации
│       │   ├── sequelize.ts    # Подключение к БД
│       │   ├── User.ts
│       │   ├── Story.ts
│       │   ├── StorySlide.ts
│       │   ├── Template.ts
│       │   ├── VoiceProfile.ts
│       │   └── Task.ts
│       ├── routes/             # Маршруты API
│       │   ├── auth.routes.ts
│       │   ├── story.routes.ts
│       │   ├── template.routes.ts
│       │   ├── share.routes.ts
│       │   └── health.routes.ts
│       ├── controllers/        # Контроллеры
│       │   ├── auth.controller.ts
│       │   ├── story.controller.ts
│       │   ├── template.controller.ts
│       │   ├── share.controller.ts
│       │   └── health.controller.ts
│       ├── services/           # Бизнес-логика
│       │   ├── ai.service.ts       # OpenAI интеграция
│       │   ├── tts.service.ts      # Текст-в-речь
│       │   ├── render.service.ts   # FFmpeg рендер
│       │   ├── ffmpeg.helper.ts    # Асинхронный FFmpeg
│       │   ├── storage.service.ts  # Хранение файлов
│       │   ├── pdf.service.ts      # Генерация PDF
│       │   └── qr.service.ts       # Генерация QR
│       ├── queues/             # BullMQ очереди
│       │   └── generationQueue.ts
│       ├── workers/            # Воркеры
│       │   └── render.worker.ts
│       ├── middleware/         # Express middleware
│       │   ├── auth.middleware.ts
│       │   ├── upload.middleware.ts
│       │   ├── validate.middleware.ts
│       │   └── error.middleware.ts
│       └── utils/
│           ├── logger.ts       # Pino логгер
│           ├── migrate.ts      # Миграции БД
│           └── seed.ts         # Начальные данные
│
└── frontend/                   # Frontend (React + Vite)
    ├── Dockerfile              # Сборка контейнера
    ├── nginx.conf              # Конфиг Nginx
    ├── .dockerignore
    ├── vite.config.ts
    ├── tsconfig.json
    ├── package.json
    └── src/
        ├── main.tsx            # Точка входа
        ├── App.tsx             # Роутинг
        ├── components/
        │   ├── Layout.tsx      # Общий лейаут
        │   └── AuthContext.tsx # Контекст аутентификации
        ├── pages/
        │   ├── HomePage.tsx
        │   ├── LoginPage.tsx
        │   ├── RegisterPage.tsx
        │   ├── CreateStoryPage.tsx
        │   ├── MyStoriesPage.tsx
        │   ├── StoryResultPage.tsx
        │   └── SharePage.tsx
        ├── services/
        │   └── api.ts          # HTTP-клиент
        └── types/
            └── index.ts        # TypeScript типы
```

---

## 🗄 Модели данных

### User

| Поле           | Тип      | Описание              |
|----------------|----------|-----------------------|
| id             | UUID     | Первичный ключ        |
| email          | STRING   | Email (уникальный)    |
| passwordHash   | STRING   | Хеш пароля (bcrypt)   |
| name           | STRING   | Имя пользователя      |
| createdAt      | DATE     | Дата создания         |
| updatedAt      | DATE     | Дата обновления       |

### Story

| Поле           | Тип      | Описание              |
|----------------|----------|-----------------------|
| id             | UUID     | Первичный ключ        |
| userId         | UUID     | Владелец (FK → User)  |
| title          | STRING   | Название истории      |
| templateId     | UUID     | Шаблон (FK → Template)|
| status         | ENUM     | Статус генерации      |
| tone           | STRING   | Тон повествования     |
| voiceGender    | ENUM     | Пол голоса            |
| scriptText     | TEXT     | Сгенерированный текст |
| videoUrl       | TEXT     | Ссылка на видео       |
| pdfUrl         | TEXT     | Ссылка на PDF         |
| qrCodeUrl      | TEXT     | Ссылка на QR-код      |
| publicUrl      | TEXT     | Публичная ссылка      |
| createdAt      | DATE     | Дата создания         |
| updatedAt      | DATE     | Дата обновления       |

### StorySlide

| Поле           | Тип      | Описание              |
|----------------|----------|-----------------------|
| id             | UUID     | Первичный ключ        |
| storyId        | UUID     | История (FK → Story)  |
| imageUrl       | TEXT     | URL изображения       |
| imageKey       | TEXT     | Ключ хранения         |
| orderIndex     | INTEGER  | Порядок слайда        |
| caption        | TEXT     | Текст на слайде       |
| durationSeconds| INTEGER  | Длительность (сек)    |
| isKeyFrame     | BOOLEAN  | Ключевой кадр         |

### Template

| Поле                   | Тип      | Описание              |
|------------------------|----------|-----------------------|
| id                     | UUID     | Первичный ключ        |
| name                   | STRING   | Название шаблона      |
| description            | TEXT     | Описание              |
| tone                   | STRING   | Тон повествования     |
| defaultDurationSeconds | INTEGER  | Длительность слайда   |
| promptTemplate         | TEXT     | Промпт для OpenAI     |

### Task

| Поле           | Тип      | Описание              |
|----------------|----------|-----------------------|
| id             | UUID     | Первичный ключ        |
| storyId        | UUID     | История (FK → Story)  |
| type           | ENUM     | Тип задачи            |
| status         | ENUM     | Статус                |
| progress       | INTEGER  | Прогресс (0-100)      |
| errorMessage   | TEXT     | Текст ошибки          |
| resultData     | JSONB    | Дополнительные данные |
| createdAt      | DATE     | Дата создания         |
| completedAt    | DATE     | Дата завершения       |

**Типы задач:** `generate_script`, `generate_tts`, `render_video`, `generate_pdf`, `generate_qr`

**Статусы задач:** `pending`, `queued`, `processing`, `completed`, `failed`

---

## ⚙️ Конфигурация

Все настройки читаются из `.env` через `backend/src/config/index.ts`.

### Переменные окружения

| Переменная           | Значение по умолчанию | Описание                  |
|----------------------|-----------------------|---------------------------|
| `PORT`               | `4000`                | Порт backend сервера      |
| `NODE_ENV`           | `development`         | Окружение                 |
| `CORS_ORIGIN`        | `http://localhost:5173`| Разрешённый origin        |
| `DB_DIALECT`         | `sqlite`              | SQLite или postgres       |
| `DB_HOST`            | `localhost`           | Хост БД                   |
| `DB_PORT`            | `5432`                | Порт БД                   |
| `DB_NAME`            | `family_cinema`       | Имя БД                    |
| `DB_USER`            | `postgres`            | Пользователь БД           |
| `DB_PASSWORD`        | `postgres`            | Пароль БД                 |
| `DB_STORAGE`         | `./database.sqlite`   | Путь к SQLite файлу       |
| `REDIS_HOST`         | `localhost`           | Хост Redis                |
| `REDIS_PORT`         | `6379`                | Порт Redis                |
| `JWT_SECRET`         | `dev-secret-key`      | Секрет JWT                |
| `JWT_EXPIRES_IN`     | `7d`                  | Срок действия JWT         |
| `STORAGE_TYPE`       | `local`               | local или s3              |
| `STORAGE_PATH`       | `./uploads`           | Папка для файлов          |
| `PUBLIC_URL`         | `http://localhost:5173` | Origin **фронтенда** — из него строятся публичная ссылка и QR-код. Это не адрес API |
| `OPENAI_API_KEY`     | (пусто)               | Ключ OpenAI-совместимого API. Обслуживает и сценарий, и озвучку. Без него текст шаблонный, а видео беззвучное |
| `OPENAI_BASE_URL`    | (пусто)               | Базовый URL. Для ProxyAPI: `https://api.proxyapi.ru/openai/v1`. Пусто — официальный OpenAI |
| `OPENAI_MODEL`       | `gpt-4o-mini`         | Модель LLM                |
| `TTS_SERVICE`        | `openai`              | `openai` — синтез через `OPENAI_BASE_URL`; `none` — намеренно беззвучная дорожка |
| `TTS_MODEL`          | `gpt-4o-mini-tts`     | Модель синтеза. `gpt-4o-mini-tts` понимает указания о подаче, `tts-1`/`tts-1-hd` — нет |
| `TTS_FORMAT`         | `mp3`                 | mp3, wav, opus, aac, flac |
| `MAX_FILE_SIZE_MB`   | `10`                  | Макс. размер файла (МБ)   |
| `MAX_PHOTOS`         | `20`                  | Макс. количество фото     |
| `FILE_RETENTION_DAYS`| `7`                   | Срок хранения файлов (метод очистки есть, планировщик не подключён) |

---

## 👨‍💻 Разработка

### Скрипты

#### Backend

| Команда           | Описание                  |
|-------------------|---------------------------|
| `npm run dev`     | Запуск с hot-reload       |
| `npm run build`   | Сборка TypeScript         |
| `npm start`       | Запуск production         |
| `npm run worker`  | Запуск воркера            |
| `npm run migrate` | Применить миграции        |
| `npm run seed`    | Заполнить БД данными      |

#### Frontend

| Команда           | Описание                  |
|-------------------|---------------------------|
| `npm run dev`     | Запуск dev сервера        |
| `npm run build`   | Сборка production         |
| `npm run preview` | Превью production         |

### Структура ответа API

Успешный ответ:
```json
{
  "success": true,
  "data": { ... }
}
```

Ошибка:
```json
{
  "success": false,
  "error": {
    "message": "Описание ошибки",
    "details": [
      { "path": "email", "message": "Некорректный email" }
    ]
  }
}
```

### Middleware

| Middleware             | Назначение                          |
|------------------------|-------------------------------------|
| `authMiddleware`       | Проверка JWT токена                 |
| `uploadPhotos`         | Загрузка изображений (Multer)       |
| `validate(schema)`     | Валидация через Zod                |
| `errorHandler`         | Глобальная обработка ошибок         |

### Логирование

Используется **Pino** — быстрый JSON-логгер.

```typescript
import { logger } from '../utils/logger';

logger.info({ storyId: 'uuid' }, 'История создана');
logger.error({ error: err.message }, 'Ошибка генерации');
logger.debug({ query: 'SELECT 1' }, 'SQL запрос');
```

### BullMQ Очередь

Очередь `generation` обрабатывает генерацию историй.

```typescript
import { generationQueue } from '../queues/generationQueue';

// Добавить задачу
const job = await generationQueue.add('generate-story', {
  storyId: 'uuid',
  userId: 'uuid',
});

// Конфигурация по умолчанию
{
  attempts: 3,                    // Повторные попытки
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: 50,           // Хранить последние 50
  removeOnFail: 20,               // Хранить последние 20
}
```

---

## ❓ FAQ

### Как переключиться с SQLite на PostgreSQL?

```env
# .env
DB_DIALECT=postgres
DB_HOST=localhost
DB_PORT=5432
DB_NAME=family_cinema
DB_USER=postgres
DB_PASSWORD=your_secure_password
```

### Как подключить S3-хранилище?

```env
STORAGE_TYPE=s3
S3_ENDPOINT=https://s3.example.com
S3_BUCKET=family-cinema
S3_ACCESS_KEY=your_key
S3_SECRET_KEY=your_secret
S3_REGION=ru-1
```

### Как запустить с Redis?

Установите Redis и убедитесь, что переменные `.env` настроены:
```env
REDIS_HOST=localhost
REDIS_PORT=6379
```

### Почему генерация не работает?

1. Проверьте наличие **FFmpeg**: `ffmpeg -version`
2. Проверьте наличие **OpenAI API ключа**
3. Проверьте логи: `npm run dev` покажет ошибки воркера
4. Проверьте здоровье: `GET http://localhost:4000/api/health`

### Как добавить новый шаблон?

```bash
# Заполнить базу начальными данными
cd backend
npm run seed
```

### Как отладить BullMQ очередь?

```bash
# Посмотреть ожидающие задачи
# Redis CLI
redis-cli
> HMGET bull:generation: waited
> HGETALL bull:generation: active
```

---

## 📄 Лицензия

MIT

## 👥 Авторы

Family Cinema Team, 2026