# API Документация

## Base URL

```
http://localhost:4000/api
```

## Формат ответов

Все ответы имеют единообразную структуру:

**Успешный ответ:**
```json
{
  "success": true,
  "data": { ... }
}
```

**Ошибка:**
```json
{
  "success": false,
  "error": {
    "message": "Описание ошибки"
  }
}
```

---

## Auth API

### POST /auth/register

Регистрация нового пользователя.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "password123",
  "name": "Иван Иванов"
}
```

**Response 200:**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "email": "user@example.com",
      "name": "Иван Иванов"
    },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

**Ошибки:**
- `409` — Email уже занят
- `422` — Невалидные данные (email, пароль < 6 символов)

---

### POST /auth/login

Вход в систему.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

**Response 200:**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "email": "user@example.com",
      "name": "Иван Иванов"
    },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

**Ошибки:**
- `401` — Неверный email или пароль

---

### GET /auth/me

Получить информацию о текущем пользователе.

**Headers:**
```
Authorization: Bearer <token>
```

**Response 200:**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "email": "user@example.com",
      "name": "Иван Иванов"
    }
  }
}
```

**Ошибки:**
- `401` — Токен не предоставлен / истёк / невалидный

---

## Templates API

### GET /templates

Получить список всех шаблонов.

**Response 200:**
```json
{
  "success": true,
  "data": {
    "templates": [
      {
        "id": "550e8400-e29b-41d4-a716-446655440000",
        "name": "День на даче",
        "description": "Тёплые моменты загородной жизни",
        "tone": "warm",
        "defaultDurationSeconds": 4,
        "createdAt": "2024-01-01T00:00:00.000Z",
        "updatedAt": "2024-01-01T00:00:00.000Z"
      }
    ]
  }
}
```

---

### GET /templates/:id

Получить шаблон по ID.

**Response 200:**
```json
{
  "success": true,
  "data": {
    "template": {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "name": "День на даче",
      "description": "Тёплые моменты загородной жизни",
      "tone": "warm",
      "defaultDurationSeconds": 4,
      "promptTemplate": "..."
    }
  }
}
```

**Ошибки:**
- `404` — Шаблон не найден

---

## Stories API

### POST /stories

Создать новую историю с фотографиями.

**Headers:**
```
Authorization: Bearer <token>
Content-Type: multipart/form-data
```

**FormData:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| photos | File[] | Да | Фотографии (1-20 файлов) |
| templateId | string | Да | ID шаблона |
| tone | string | Нет | Тон: warm, ironic, solemn |
| voiceGender | string | Нет | Голос: male, female |
| title | string | Нет | Название истории |

**Ограничения:**
- Максимум 20 файлов
- Максимальный размер файла: 10 МБ
- Форматы: JPG, PNG, WebP

**Response 201:**
```json
{
  "success": true,
  "data": {
    "story": {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "title": "Наше лето на даче",
      "status": "draft",
      "slidesCount": 5
    }
  }
}
```

**Ошибки:**
- `401` — Требуется авторизация
- `404` — Шаблон не найден
- `422` — Нет фотографий / невалильные файлы

---

### GET /stories

Получить все истории пользователя.

**Headers:**
```
Authorization: Bearer <token>
```

**Response 200:**
```json
{
  "success": true,
  "data": {
    "stories": [
      {
        "id": "550e8400-e29b-41d4-a716-446655440000",
        "title": "Наше лето на даче",
        "status": "ready",
        "tone": "warm",
        "voiceGender": "female",
        "scriptText": "Текст сценария...",
        "videoUrl": "/uploads/videos/story-xxx.mp4",
        "pdfUrl": "/uploads/pdfs/story-xxx.pdf",
        "qrCodeUrl": "/uploads/qrcodes/qrcode-xxx.png",
        "publicUrl": "http://localhost:4000/share/xxx",
        "template": {
          "id": "...",
          "name": "День на даче",
          "description": "...",
          "tone": "warm"
        },
        "slides": [
          {
            "id": "...",
            "imageUrl": "/uploads/photos/xxx.jpg",
            "orderIndex": 0,
            "isKeyFrame": true,
            "caption": "Текст для первого кадра"
          }
        ],
        "createdAt": "2024-01-01T00:00:00.000Z",
        "updatedAt": "2024-01-01T00:00:00.000Z"
      }
    ]
  }
}
```

---

### GET /stories/:id

Получить историю по ID.

**Headers:**
```
Authorization: Bearer <token>
```

**Response 200:**
```json
{
  "success": true,
  "data": {
    "story": { ... }
  }
}
```

**Ошибки:**
- `401` — Требуется авторизация
- `404` — История не найдена

---

### GET /stories/:id/status

Получить статус генерации истории.

**Headers:**
```
Authorization: Bearer <token>
```

**Response 200:**
```json
{
  "success": true,
  "data": {
    "story": {
      "id": "...",
      "status": "rendering",
      "videoUrl": null,
      "pdfUrl": null,
      "qrCodeUrl": null,
      "publicUrl": null,
      "scriptText": "Текст сценария...",
      "updatedAt": "2024-01-01T00:00:00.000Z"
    }
  }
}
```

**Возможные статусы:**
| Статус | Описание |
|--------|----------|
| `draft` | Черновик, генерация не запущена |
| `script_generating` | ИИ генерирует сценарий |
| `script_ready` | Сценарий готов, ожидает рендеринга |
| `rendering` | Мозаика видео |
| `ready` | Всё готово |
| `error` | Произошла ошибка |

---

### PUT /stories/:id/slides

Обновить порядок и настройки слайдов.

**Headers:**
```
Authorization: Bearer <token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "slides": [
    {
      "id": "slide-uuid-1",
      "orderIndex": 0,
      "caption": "Новый текст для кадра",
      "durationSeconds": 5,
      "isKeyFrame": true
    },
    {
      "id": "slide-uuid-2",
      "orderIndex": 1,
      "caption": "Ещё текст",
      "durationSeconds": 4,
      "isKeyFrame": false
    }
  ]
}
```

**Response 200:**
```json
{
  "success": true,
  "data": {
    "message": "Слайды обновлены"
  }
}
```

---

### POST /stories/:id/generate

Запустить полную генерацию (сценарий → TTS → видео → PDF → QR).

**Headers:**
```
Authorization: Bearer <token>
```

**Response 200:**
```json
{
  "success": true,
  "data": {
    "message": "Генерация запущена",
    "storyId": "550e8400-e29b-41d4-a716-446655440000",
    "status": "script_generating"
  }
}
```

**Процесс генерации:**
1. Генерация сценария через OpenAI GPT
2. Обновление слайдов с текстом
3. Синтез речи (TTS)
4. Мозаика видео через FFmpeg
5. Генерация QR-кода
6. Генерация PDF-альбома

> **Важно:** Генерация асинхронная. Используйте `GET /stories/:id/status` для отслеживания прогресса.

---

### DELETE /stories/:id

Удалить историю и все связанные файлы.

**Headers:**
```
Authorization: Bearer <token>
```

**Response 200:**
```json
{
  "success": true,
  "data": {
    "message": "История удалена"
  }
}
```

**Ошибки:**
- `401` — Требуется авторизация
- `404` — История не найдена

---

## Share API

### GET /share/:id

Публичный просмотр истории (без авторизации).

**Response 200:**
```json
{
  "success": true,
  "data": {
    "story": {
      "id": "...",
      "title": "Наше лето на даче",
      "videoUrl": "/uploads/videos/story-xxx.mp4",
      "pdfUrl": "/uploads/pdfs/story-xxx.pdf",
      "qrCodeUrl": "/uploads/qrcodes/qrcode-xxx.png",
      "slides": [
        {
          "imageUrl": "/uploads/photos/xxx.jpg",
          "caption": "Текст кадра",
          "orderIndex": 0
        }
      ],
      "template": {
        "id": "...",
        "name": "День на даче",
        "description": "Тёплые моменты загородной жизни"
      }
    }
  }
}
```

**Ошибки:**
- `404` — История не найдена или ещё не готова

---

## Health Check

### GET /api/health

Проверка работоспособности сервера.

**Response 200:**
```json
{
  "success": true,
  "data": {
    "status": "ok",
    "timestamp": "2024-01-01T00:00:00.000Z",
    "uptime": 3600.5
  }
}
```

---

## Error Codes

| Код | Описание |
|-----|----------|
| 400 | Неверный запрос |
| 401 | Неавторизован (токен отсутствует/истёк/неверный) |
| 403 | Нет доступа |
| 404 | Ресурс не найден |
| 409 | Конфликт (email занят) |
| 422 | Валидация не пройдена |
| 500 | Внутренняя ошибка сервера |

---

## Rate Limiting

TODO: Добавить ограничение частоты запросов.
