# Руководство разработчика

## 📋 Содержание

1. [Структура проекта](#структура-проекта)
2. [Настройка окружения](#настройка-окружения)
3. [Разработка](#разработка)
4. [Конвенции кода](#конвенции-кода)
5. [Работа с БД](#работа-с-бд)
6. [Добавление нового функционала](#добавление-нового-функционала)
7. [Отладка](#отладка)

---

## Структура проекта

```
cinem2/
├── frontend/                 # React + Vite + TypeScript
│   ├── src/
│   │   ├── components/       # Переиспользуемые компоненты
│   │   ├── pages/            # Страницы приложения
│   │   ├── services/         # API-клиенты и внешние сервисы
│   │   ├── types/            # TypeScript интерфейсы
│   │   ├── App.tsx           # Роутинг + провайдеры
│   │   ├── main.tsx          # Точка входа
│   │   └── styles.css        # Глобальные стили
│   ├── public/               # Статика
│   ├── index.html
│   ├── vite.config.ts
│   └── package.json
│
├── backend/                  # Express + TypeScript + Sequelize
│   ├── src/
│   │   ├── server.ts         # Точка входа
│   │   ├── app.ts            # Конфигурация Express
│   │   ├── config/           # Переменные окружения
│   │   ├── models/           # Sequelize модели
│   │   ├── controllers/      # Обработка запросов
│   │   ├── services/         # Бизнес-логика
│   │   ├── routes/           # API-маршруты
│   │   ├── middleware/       # Промежуточное ПО
│   │   └── utils/            # Утилиты
│   └── package.json
│
└── docs/                     # Документация
```

---

## Настройка окружения

### Предварительные требования

- **Node.js** 18+
- **npm** 9+
- **FFmpeg** (для генерации видео)
- **Git**

### Установка

```bash
# 1. Клонирование репозитория
git clone <repo-url>
cd cinem2

# 2. Настройка PowerShell (Windows)
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned

# 3. Установка зависимостей frontend
cd frontend
npm install

# 4. Установка зависимостей backend
cd ../backend
npm install
```

### Переменные окружения

Создайте `.env` в `backend/`:

```env
# Скопируйте из .env.example и отредактируйте
copy .env.example .env
```

**Ключевые переменные:**

| Переменная | Описание | Default |
|-----------|----------|---------|
| `PORT` | Порт сервера | `4000` |
| `NODE_ENV` | Окружение | `development` |
| `JWT_SECRET` | Секрет для JWT | `dev-secret-key` |
| `OPENAI_API_KEY` | Ключ OpenAI | (пусто) |
| `DB_DIALECT` | Диалект БД | `sqlite` |

---

## Разработка

### Команды

#### Frontend

```bash
cd frontend

# Dev-сервер с hot-reload
npm run dev

# Сборка для production
npm run build

# Preview production сборки
npm run preview
```

Dev-сервер доступен на http://localhost:5173

#### Backend

```bash
cd backend

# Dev-сервер с auto-restart
npm run dev

# Сборка TypeScript
npm run build

# Production запуск
npm start
```

Server доступен на http://localhost:4000

### Proxy API

Vite настроен на проксирование `/api` запросов на backend:

```typescript
// frontend/vite.config.ts
export default defineConfig({
  server: {
    proxy: {
      '/api': 'http://localhost:4000',
    },
  },
});
```

Это позволяет фронтенду обращаться к API как к относительным путям (`/api/stories`).

---

## Конвенции кода

### TypeScript

#### Имена файлов

- **Backend:** `snake_case.ts` (например, `auth.middleware.ts`)
- **Frontend:** `PascalCase.tsx` для компонентов (например, `HomePage.tsx`)

#### Интерфейсы и типы

```typescript
// Интерфейсы для моделей данных
interface User {
  id: string;
  email: string;
  name: string;
}

// Optional поля с ?
interface Story {
  id: string;
  title: string;
  scriptText?: string | null;
}

// Union types
type StoryStatus = 'draft' | 'script_generating' | 'ready' | 'error';
type VoiceGender = 'male' | 'female';
```

#### Экспорт

```typescript
// Named export для классов
export class StoryController {
  async create() { ... }
}

// Singleton instance
export const storyController = new StoryController();

// Функции
export function validate(schema: ZodSchema) { ... }
```

### Backend

#### Структура контроллера

```typescript
export class StoryController {
  async create(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      // 1. Валидация входных данных
      const { templateId } = req.body;
      if (!templateId) {
        return res.status(422).json({
          success: false,
          error: { message: 'Укажите templateId' },
        });
      }

      // 2. Бизнес-логика
      const story = await Story.create({ ... });

      // 3. Ответ
      res.status(201).json({
        success: true,
        data: { story },
      });
    } catch (error) {
      next(error); // Передача в error middleware
    }
  }
}
```

#### Структура сервиса

```typescript
export class AIService {
  async generateScript(params: ScriptParams): Promise<ScriptResult> {
    // 1. Проверка доступности сервиса
    if (!this.openai) {
      return this.mockScriptGeneration(params);
    }

    // 2. Основной функционал
    const response = await this.openai.chat.completions.create({ ... });

    // 3. Парсинг и возврат результата
    return this.parseResponse(response);
  }
}
```

#### Обработка ошибок

```typescript
// Создание кастомной ошибки
export class AppError extends Error {
  constructor(message: string, statusCode: number = 500) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
  }
}

// Использование
throw new AppError('Шаблон не найден', 404);
```

### Frontend

#### Структура компонента

```typescript
import React, { useState, useEffect } from 'react';
import { useAuth } from '../components/AuthContext';
import { api } from '../services/api';

interface Props {
  // Если есть props
}

export default function HomePage({}: Props) {
  const { isAuthenticated } = useAuth();
  const [data, setData] = useState<Data[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const res = await api.getData();
      setData(res.data);
    } catch (error) {
      toast.error('Ошибка загрузки');
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) return <div className="loading">Загрузка...</div>;

  return (
    <div className="home-page">
      <h1>Главная</h1>
      {/* JSX */}
    </div>
  );
}
```

#### Работа с API

```typescript
// Использование api-сервиса
const res = await api.createStory(formData);
const story = res.data.story;

// Обработка ошибок
try {
  await api.deleteStory(storyId);
  toast.success('История удалена');
} catch (error: any) {
  const message = error.response?.data?.error?.message || 'Ошибка';
  toast.error(message);
}
```

---

## Работа с БД

### Sequelize модели

```typescript
import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from './sequelize';

interface UserAttributes {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: Date;
}

interface UserCreationAttributes extends Optional<UserAttributes, 'id' | 'createdAt'> {}

export class User extends Model<UserAttributes, UserCreationAttributes> 
  implements UserAttributes 
{
  public id!: string;
  public email!: string;
  public passwordHash!: string;
  public readonly createdAt!: Date;
}

User.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    email: {
      type: DataTypes.STRING(255),
      allowNull: false,
      unique: true,
    },
  },
  {
    sequelize,
    tableName: 'users',
    timestamps: true,
  }
);
```

### Ассоциации

```typescript
// В models/index.ts
User.hasMany(Story, { foreignKey: 'userId', as: 'stories' });
Story.belongsTo(User, { foreignKey: 'userId', as: 'user' });

Story.belongsTo(Template, { foreignKey: 'templateId', as: 'template' });
Template.hasMany(Story, { foreignKey: 'templateId', as: 'stories' });

Story.hasMany(StorySlide, { foreignKey: 'storyId', as: 'slides' });
StorySlide.belongsTo(Story, { foreignKey: 'storyId', as: 'story' });
```

### Миграции

```bash
# Запуск миграций
npm run migrate

# Seed данных
npm run seed
```

---

## Добавление нового функционала

### 1. Новая модель БД

1. Создать файл в `backend/src/models/`
2. Определить интерфейс и класс модели
3. Добавить ассоциации в `models/index.ts`
4. Экспортировать из `models/index.ts`

### 2. Новый API-эндпоинт

1. Создать роут в `backend/src/routes/`
2. Создать метод в контроллере `backend/src/controllers/`
3. Добавить бизнес-логику в сервис `backend/src/services/`
4. Добавить метод в API-клиент `frontend/src/services/api.ts`
5. Создать страницу или компонент `frontend/src/pages/`
6. Добавить роутинг в `frontend/src/App.tsx`

### 3. Новый сервис

1. Создать файл в `backend/src/services/`
2. Определить интерфейс входных/выходных данных
3. Реализовать бизнес-логику
4. Добавить обработку ошибок
5. Настроить логирование

---

## Отладка

### Backend

#### Логи

```bash
# Dev-режим (подробные логи)
npm run dev

# Production-режим (только ошибки)
NODE_ENV=production npm start
```

#### Отладка в VS Code

Добавьте `.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Debug Backend",
      "skipFiles": ["<node_internals>/**"],
      "program": "${workspaceFolder}/backend/node_modules/ts-node-dev/bin/ts-node-dev",
      "args": ["--respawn", "--transpile-only", "src/server.ts"],
      "cwd": "${workspaceFolder}/backend",
      "runtimeArgs": ["--loader", "ts-node/esm"],
      "env": { "NODE_ENV": "development" }
    }
  ]
}
```

### Frontend

#### React DevTools

Установите расширение [React DevTools](https://chrome.google.com/webstore/detail/react-developer-tools) для Chrome/Firefox.

#### Отладка в VS Code

Добавьте `.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "chrome",
      "request": "launch",
      "name": "Debug Frontend",
      "url": "http://localhost:5173",
      "webRoot": "${workspaceFolder}/frontend/src"
    }
  ]
}
```

---

## Полезные ссылки

- [React Docs](https://react.dev)
- [TypeScript Handbook](https://www.typescriptlang.org/docs)
- [Vite Docs](https://vitejs.dev)
- [Express Docs](https://expressjs.com)
- [Sequelize Docs](https://sequelize.org)
- [OpenAI Docs](https://platform.openai.com)
- [FFmpeg Docs](https://ffmpeg.org/documentation.html)
