# Contributing to Family Cinema

Спасибо за интерес к участию в проекте Family Cinema!

## 📋 Содержание

- [Как внести вклад](#-как-внести-вклад)
- [Процесс разработки](#-процесс-разработки)
- [Стандарты кода](#-стандарты-кода)
- [Commit messages](#-commit-messages)
- [Testing](#-testing)

## 🤝 Как внести вклад

1. **Fork** репозитория
2. **Создайте ветку** для вашей функции: `git checkout -b feature/my-feature`
3. **Внесите изменения** и проверьте их
4. **Отправьте Pull Request** с описанием изменений

## 🔄 Процесс разработки

### Local Development

```bash
# 1. Установка зависимостей
cd backend && npm install
cd ../frontend && npm install
cd ..

# 2. Настройка окружения
cp backend/.env.example backend/.env

# 3. Запуск (2 терминала)
# Terminal 1:
cd backend && npm run dev

# Terminal 2:
cd frontend && npm run dev
```

### Docker Development

```bash
docker compose up --build
```

## 📝 Стандарты кода

### TypeScript

- **Strict mode** — всегда включён
- **No `any`** — используйте конкретные типы
- **Interfaces для public API** — types для внутренних структур
- **Named exports** — предпочитаем `export const` вместо `export default`

### Пример хорошего кода

```typescript
// ✅ Хорошо
interface User {
  id: string;
  email: string;
  name: string;
}

export async function getUserById(id: string): Promise<User | null> {
  const user = await User.findByPk(id);
  return user ?? null;
}

// ❌ Плохо
export async function getUserById(id: any): Promise<any> {
  const user = await User.findByPk(id);
  return user;
}
```

### Naming Conventions

| Элемент             | Convention        | Пример              |
|---------------------|-------------------|---------------------|
| Файлы               | kebab-case        | `story.routes.ts`   |
| Компоненты React    | PascalCase        | `CreateStoryPage.tsx`|
| Функции/переменные  | camelCase         | `generateStory()`   |
| Константы           | UPPER_SNAKE_CASE  | `MAX_PHOTOS`        |
| Классы              | PascalCase        | `StoryController`   |
| Интерфейсы/типы     | PascalCase        | `StoryAttributes`   |
| Переменные окружения| UPPER_SNAKE_CASE  | `DB_HOST`           |

### Структура файлов

```
src/
├── controllers/     # Обработка запросов
├── services/        # Бизнес-логика
├── models/          # Модели данных
├── routes/          # Маршруты
├── middleware/      # Middleware
├── queues/          # BullMQ очереди
├── workers/         # Воркеры
├── utils/           # Утилиты
└── config/          # Конфигурация
```

## 📌 Commit Messages

Используем **Conventional Commits**:

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

### Types

| Type         | Описание                              |
|--------------|---------------------------------------|
| `feat`       | Новая функция                         |
| `fix`        | Исправление бага                      |
| `docs`       | Изменение документации                |
| `style`      | Форматирование, без изменения кода    |
| `refactor`   | Рефакторинг                           |
| `test`       | Добавление/изменение тестов           |
| `chore`      | Поддерживающие изменения              |
| `ci`         | CI/CD конфигурация                    |
| `perf`       | Улучшение производительности          |

### Примеры

```bash
feat(stories): add BullMQ queue for video generation
fix(auth): resolve JWT token expiration issue
docs(readme): update API reference with new endpoints
refactor(render): replace execSync with async spawn
test(stories): add integration tests for generate endpoint
```

## 🧪 Testing

> **TODO**: Добавить тестовый фреймворк (Jest + Supertest)

### Рекомендуемая структура тестов

```
backend/
├── tests/
│   ├── unit/
│   │   ├── controllers/
│   │   ├── services/
│   │   └── queues/
│   ├── integration/
│   │   └── api/
│   └── fixtures/
```

### Запуск тестов (когда будут добавлены)

```bash
npm run test        # Все тесты
npm run test:unit   # Unit тесты
npm run test:int    # Integration тесты
```

---

Спасибо за ваш вклад! 🎉
