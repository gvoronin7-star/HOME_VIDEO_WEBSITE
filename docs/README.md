# Family Cinema — Документация проекта

## 📋 О проекте

**Family Cinema** — веб-приложение для создания семейных видео из фотографий с помощью ИИ. Пользователь загружает фотографии, выбирает шаблон и настроение, а система автоматически генерирует сценарий, озвучку, монтирует видео, создаёт PDF-альбом и QR-код для шаринга.

### 🚀 Ключевые возможности

- **Загрузка фото** — до 20 фотографий (JPG, PNG, WebP) с drag-and-drop сортировкой
- **ИИ-сценарий** — генерация тёплого текста для каждого кадра через OpenAI GPT
- **Озвучка** — синтез речи (TTS) с выбором голоса (мужской/женский)
- **Монтаж видео** — создание MP4 через FFmpeg с наложением текста (асинхронно)
- **PDF-альбом** — генерация печатного альбома с фото и сценарием
- **QR-код** — для быстрого шаринга видео
- **Публичные ссылки** — просмотр готовых видео без авторизации
- **Очереди задач** — BullMQ + Redis для асинхронной обработки
- **Health Check** — проверка работоспособности системы

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

#### Создание истории
```
Загрузка фото → Оптимизация (Sharp) → Сохранение → Создание записи Story
```

#### Генерация видео
```
POST /stories/:id/generate
  → Создание Task (status: queued)
  → Добавление в BullMQ очередь
  → Worker: Script (OpenAI) → TTS → Video (FFmpeg) → QR + PDF
  → Обновление Task (status: completed)
```

---

## 📦 Стек технологий

### Frontend
| Технология | Версия | Назначение |
|-----------|--------|-----------|
| React | 18.3+ | UI библиотека |
| TypeScript | 5.5+ | Типизация |
| Vite | 5.4+ | Сборщик и dev-сервер |
| React Router | 6.26+ | Роутинг |
| Axios | 1.7+ | HTTP-клиент |
| react-dropzone | 14.2+ | Drag-and-drop загрузка |
| react-hot-toast | 2.4+ | Уведомления |
| react-beautiful-dnd | 13.1 | Сортировка элементов |
| qrcode.react | 4.0 | QR-коды на клиенте |

### Backend
| Технология | Версия | Назначение |
|-----------|--------|-----------|
| Express | 4.19+ | Web-фреймворк |
| TypeScript | 5.5+ | Типизация |
| Sequelize | 6.37+ | ORM для БД |
| SQLite/PostgreSQL | — | Хранение данных |
| JWT | 9.0+ | Аутентификация |
| OpenAI | 4.55+ | Генерация сценариев |
| FFmpeg | — | Монтаж видео |
| sharp | 0.33+ | Оптимизация изображений |
| PDFKit | 0.15+ | Генерация PDF |
| qrcode | 1.5+ | Генерация QR-кодов |
| Pino | 9.3+ | Логирование |
| Zod | 3.23+ | Валидация схем |
| BullMQ | 5.1+ | Очереди задач |
| ioredis | 5.4+ | Redis клиент |

### Инфраструктура
| Технология | Версия | Назначение |
|-----------|--------|-----------|
| Docker | — | Контейнеризация |
| Docker Compose | — | Оркестрация сервисов |
| Nginx | alpine | Веб-сервер для фронтенда |
| PostgreSQL | 15 | Production БД |
| Redis | 7 | BullMQ очередь |

---

## 🔌 API Документация

### Базовый URL
```
http://localhost:4000/api
```

### Аутентификация

Все защищённые маршруты требуют заголовок:
```
Authorization: Bearer <JWT-токен>
```

### Маршруты

#### 🔐 Auth

| Метод | Путь | Описание | Авторизация |
|-------|------|----------|-------------|
| POST | `/auth/register` | Регистрация | Нет |
| POST | `/auth/login` | Вход | Нет |
| GET | `/auth/me` | Текущий пользователь | Да |

**Request (register/login):**
```json
{
  "email": "user@example.com",
  "password": "password123",
  "name": "Иван" // опционально
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "user": { "id": "uuid", "email": "...", "name": "..." },
    "token": "jwt-token-here"
  }
}
```

#### 📄 Templates

| Метод | Путь | Описание | Авторизация |
|-------|------|----------|-------------|
| GET | `/templates` | Список шаблонов | Нет |
| GET | `/templates/:id` | Шаблон по ID | Нет |

#### 📖 Stories

| Метод | Путь | Описание | Авторизация |
|-------|------|----------|-------------|
| POST | `/stories` | Создать историю | Да |
| GET | `/stories` | Мои истории | Да |
| GET | `/stories/:id` | История по ID | Да |
| GET | `/stories/:id/status` | Статус генерации | Да |
| PUT | `/stories/:id/slides` | Обновить слайды | Да |
| POST | `/stories/:id/generate` | Запустить генерацию | Да |
| DELETE | `/stories/:id` | Удалить историю | Да |

**Запуск генерации** — `POST /stories/:id/generate`

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

**Проверка статуса** — `GET /stories/:id/status`

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

#### 🔗 Share

| Метод | Путь | Описание | Авторизация |
|-------|------|----------|-------------|
| GET | `/share/:id` | Публичный просмотр | Нет |

#### 🏥 Health Check

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/health` | Проверка работоспособности |

---

## 🗄 Модель данных

### User
- `id` — UUID
- `email` — уникальный email
- `passwordHash` — хеш пароля (bcrypt)
- `name` — имя пользователя

### Template
- `id` — UUID
- `name` — название шаблона
- `description` — описание
- `tone` — тон (warm/ironic/solemn)
- `defaultDurationSeconds` — длительность кадра по умолчанию

### Story
- `id` — UUID
- `userId` — UUID → User
- `title` — название
- `templateId` — UUID → Template
- `status` — enum статусов
- `tone` — тон сценария
- `voiceGender` — male/female
- `scriptText` — текст сценария
- `videoUrl` — URL видео
- `pdfUrl` — URL PDF-альбома
- `qrCodeUrl` — URL QR-кода
- `publicUrl` — публичная ссылка

### StorySlide
- `id` — UUID
- `storyId` — UUID → Story
- `imageUrl` — URL изображения
- `imageKey` — ключ в хранилище
- `orderIndex` — порядок
- `caption` — текст кадра
- `durationSeconds` — длительность
- `isKeyFrame` — ключевой кадр

### Task
- `id` — UUID
- `storyId` — UUID → Story
- `type` — enum типов задач
- `status` — pending/queued/processing/completed/failed
- `progress` — 0-100
- `errorMessage` — текст ошибки
- `resultData` — JSON результат
- `completedAt` — дата завершения

**Типы задач:** `generate_script`, `generate_tts`, `render_video`, `generate_pdf`, `generate_qr`

### Story (новые поля)
- `scriptText` — текст сценария
- `videoUrl` — URL видео
- `pdfUrl` — URL PDF-альбома
- `qrCodeUrl` — URL QR-кода
- `publicUrl` — публичная ссылка

**Статусы истории:**
- `draft` — черновик
- `script_generating` — генерация сценария
- `script_ready` — сценарий готов
- `rendering` — рендеринг видео
- `ready` — готово
- `error` — ошибка

### VoiceProfile
- `id` — UUID
- `name` — имя голоса
- `gender` — male/female
- `emotion` — эмоция
- `apiVoiceId` — ID в TTS-сервисе
- `previewUrl` — превью аудио

---

## ⚙️ Переменные окружения

### Backend (.env)

```env
# Server
PORT=4000
NODE_ENV=development
CORS_ORIGIN=http://localhost:5173

# Database
DB_DIALECT=sqlite
DB_STORAGE=./database.sqlite
# Для PostgreSQL:
# DB_DIALECT=postgres
# DB_HOST=localhost
# DB_PORT=5432
# DB_NAME=family_cinema
# DB_USER=postgres
# DB_PASSWORD=postgres

# Redis (для очередей в будущем)
REDIS_HOST=localhost
REDIS_PORT=6379

# JWT
JWT_SECRET=your-secret-key
JWT_EXPIRES_IN=7d

# Storage
STORAGE_TYPE=local
STORAGE_PATH=./uploads

# OpenAI
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini

# TTS
TTS_SERVICE=browser

# FFmpeg
FFMPEG_PATH=ffmpeg
FFPROBE_PATH=ffprobe

# Limits
MAX_FILE_SIZE_MB=10
MAX_PHOTOS=20
FILE_RETENTION_DAYS=7

# Public
PUBLIC_URL=http://localhost:4000
```

---

## 🚀 Запуск проекта

### Предварительные требования

- Node.js 18+
- FFmpeg (для генерации видео)
- npm или yarn

### 1. Установка зависимостей

```bash
# Frontend
cd frontend
npm install

# Backend
cd backend
npm install
```

### 2. Настройка переменных окружения

```bash
cd backend
copy .env.example .env
# Отредактируйте .env
```

### 3. Запуск

```bash
# Backend
cd backend
npm run dev

# Frontend (в другом терминале)
cd frontend
npm run dev
```

### 4. Запуск через PowerShell (Windows)

Если возникает ошибка `Execution Policy`, выполните:

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

### 5. Доступ

- Frontend: http://localhost:5173
- Backend: http://localhost:4000
- API: http://localhost:4000/api
- Health: GET http://localhost:4000/api/health

---

## 🐳 Развёртывание через Docker

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

## 📐 Структура кода

### Frontend

- **Компоненты** — переиспользуемые UI-блоки (Layout, AuthContext)
- **Страницы** — полные экраны приложения
- **Services** — HTTP-клиент с интерсепторами
- **Types** — TypeScript интерфейсы

### Backend

- **Controllers** — обработка запросов, вызов сервисов
- **Services** — бизнес-логика (AI, TTS, Render, Storage)
- **Routes** — определение API-маршрутов
- **Middleware** — авторизация, валидация, обработка ошибок
- **Models** — ORM-модели Sequelize

---

## 🔄 BullMQ Очереди

### Генерация историй

Очередь `generation` обрабатывает генерацию историй асинхронно.

```typescript
import { generationQueue } from '../queues/generationQueue';

// Добавить задачу
const job = await generationQueue.add('generate-story', {
  storyId: 'uuid',
  userId: 'uuid',
});
```

**Конфигурация по умолчанию:**
```typescript
{
  attempts: 3,                    // Повторные попытки
  backoff: { type: 'exponential', delay: 5000 }, // 5сек → 10сек → 20сек
  removeOnComplete: 50,           // Хранить последние 50
  removeOnFail: 20,               // Хранить последние 20
}
```

### Pipeline обработки

1. **Script** — генерация сценария (OpenAI)
2. **TTS** — синтез речи
3. **Video** — рендер видео (FFmpeg)
4. **QR + PDF** — генерация материалов

---

## 📁 Структура проекта

```
cinem2/
├── docker-compose.yml          # Оркестрация сервисов
├── .env.example                # Шаблон переменных окружения
│
├── backend/
│   ├── Dockerfile              # Multi-stage build
│   ├── src/
│   │   ├── server.ts           # Точка входа
│   │   ├── app.ts              # Express конфигурация
│   │   ├── config/             # Централизованная конфигурация
│   │   ├── models/             # Sequelize модели
│   │   ├── routes/             # API маршруты
│   │   ├── controllers/        # Обработка запросов
│   │   ├── services/           # Бизнес-логика
│   │   │   ├── render.service.ts   # FFmpeg рендер
│   │   │   └── ffmpeg.helper.ts    # Async FFmpeg
│   │   ├── queues/             # BullMQ очереди
│   │   │   └── generationQueue.ts
│   │   ├── workers/            # Воркеры
│   │   │   └── render.worker.ts
│   │   ├── middleware/         # Express middleware
│   │   └── utils/              # Утилиты
│
└── frontend/
    ├── Dockerfile              # Сборка + Nginx
    ├── nginx.conf              # Проксирование API
    └── src/
        ├── App.tsx             # Роутинг
        ├── components/         # UI компоненты
        ├── pages/              # Страницы
        ├── services/           # HTTP-клиент
        └── types/              # TypeScript типы
```

- JWT-токены с истечением 7 дней
- Хэширование паролей bcrypt
- Валидация входных данных через Zod
- Ограничение размера файлов
- CORS с белым списком доменов
- Логирование с маскированием чувствительных данных

---

## 🧪 Тестирование

TODO: Добавить unit-тесты для сервисов и интеграционные тесты для API.

---

## 📈 Масштабирование

Текущая архитектура поддерживает:

- ✅ **S3-совместимое хранилище** — переключение через `STORAGE_TYPE=s3`
- ✅ **PostgreSQL** — переключение через `DB_DIALECT=postgres`
- ✅ **Redis-очереди** — BullMQ подключён и используется
- ✅ **Асинхронный FFmpeg** — не блокирует event loop
- ✅ **Docker контейнеры** — готово к деплою
- Azure Speech / Yandex SpeechKit — TODO в TTS сервисе
- Масштабирование FFmpeg — через workers/пул процессов

---

## 📝 TODO

- [ ] Интеграция Azure Speech / Yandex SpeechKit
- [ ] Unit-тесты (Jest)
- [ ] Интеграционные тесты API (Supertest)
- [ ] E2E тесты (Playwright)
- [ ] Rate limiting
- [ ] Кэширование шаблонов
- [ ] WebSockets для real-time статусов
- [ ] Многоязычность (i18n)

---

## 📞 Контакты

TODO: Добавить информацию о команде и контакты.
