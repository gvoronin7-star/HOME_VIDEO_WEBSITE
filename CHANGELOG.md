# Changelog

Все значимые изменения этого проекта будут задокументированы в этом файле.

Формат основан на [Keep a Changelog](https://keepachangelog.com/ru-RU/1.1.0/),
и проект придерживается [Semantic Versioning](https://semver.org/lang/ru/).

## [Unreleased]

### Added
- Docker + Docker Compose конфигурация
  - `backend/Dockerfile` — multi-stage build для Node.js + FFmpeg
  - `frontend/Dockerfile` — сборка React + Nginx
  - `docker-compose.yml` — оркестрация PostgreSQL, Redis, Backend, Frontend
  - `frontend/nginx.conf` — проксирование API и uploads
- BullMQ очередь задач
  - `backend/src/queues/generationQueue.ts` — очередь генерации
  - `backend/src/workers/render.worker.ts` — BullMQ worker вместо setInterval
  - Retry: 3 попытки с exponential backoff (5 сек)
- Асинхронный FFmpeg
  - `backend/src/services/ffmpeg.helper.ts` — spawn с прогрессом
  - Замена `execSync` на `exec`/`spawn` в `render.service.ts`
- Health Check API
  - `GET /api/health` — проверка БД, Redis, FFmpeg
  - Статусы: `ok`, `degraded`, `unhealthy`
- Task модель
  - Статусы: `pending`, `queued`, `processing`, `completed`, `failed`
  - Прогресс генерации (0–100%)
- Документация
  - `README.md` — полная документация проекта
  - `CONTRIBUTING.md` — правила внесения изменений
- Версионированные миграции (`umzug` поверх `sequelize.sync()`)
  - `backend/src/migrations/` — миграция, добавляющая `Story.shareToken`
  - `backend/src/migrations/runner.ts` — явный список миграций, без glob-обнаружения
- ESLint + Prettier в обоих пакетах, `npm run lint` в корневом `package.json`
- Компьютерное зрение для сценария — `aiService.generateScript()` отправляет модели реальные
  фото (`image_url`, `detail: 'low'`) вместо текстовых заглушек; `utils/imageDataUri.ts` кодирует
  фото в base64 data URI
- Отзыв и ротация публичной ссылки (S6)
  - `Story.shareToken` — отдельный UUID, независимый от `id` истории
  - `POST /api/stories/:id/share/rotate`, `DELETE /api/stories/:id/share`
- `POST /api/auth/logout` — очищает httpOnly-cookie (JS не может сделать это сам)
- Отдельный процесс воркера (P3) — сервис `worker` в `docker-compose.yml`,
  `npm run dev:worker` локально; `server.ts` больше его не запускает

### Changed
- `POST /api/stories/:id/generate` — теперь возвращает `taskId` и `queued`
- `GET /api/stories/:id/status` — возвращает данные из Task модели
- `render.worker.ts` — переписан на BullMQ (без setInterval)
- `render.service.ts` — асинхронные вызовы FFmpeg
- JWT-токен переехал из тела ответа/localStorage в httpOnly-cookie (S5) — `Authorization: Bearer`
  продолжает работать для API-клиентов и тестов, заголовок приоритетнее cookie
- Загрузка фото переведена с `multer.memoryStorage()` на `diskStorage()` (P4) — запрос больше не
  буферизует все фото целиком в памяти процесса
- Воркер регенерирует сценарий только если у истории его ещё нет — повторный запуск генерации
  больше не затирает сценарий, сгенерированный при создании, или подписи, отредактированные вручную

### Fixed
- Debounce логов Redis ошибки (не спамит при недоступности)
- Lazy loading BullMQ worker (не блокирует старт без Redis)
- SSL для Postgres больше не выводится из `NODE_ENV`, а задаётся явным `DB_SSL`
- `GET /api/share/:token` — smoke-тест CI строил ссылку по `id` истории после введения `shareToken`

---

## [0.1.0] — 2026-08-06

### Initial Release

#### Features
- Регистрация и авторизация (JWT)
- CRUD историй с загрузкой фотографий
- Шаблоны историй
- AI-сценарий через OpenAI
- TTS озвучка (браузерная)
- Генерация видео через FFmpeg
- QR-код генерация
- PDF-альбом
- Публичный доступ к историям
- SQLite по умолчанию, PostgreSQL опционально
- Sharp оптимизация изображений
- Pino логирование
- Zod валидация
- Error middleware

#### Tech Stack
- Backend: Express + TypeScript + Sequelize
- Frontend: React + Vite + TypeScript
- Database: SQLite / PostgreSQL
- Queue: BullMQ + Redis
- Storage: Local FS
