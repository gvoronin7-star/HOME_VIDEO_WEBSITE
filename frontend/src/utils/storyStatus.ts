import { Story } from '../types';

/**
 * Was duplicated in MyStoriesPage.tsx and StoryResultPage.tsx with slightly
 * different wording and a genuinely diverging color for `draft` (#6b7280 vs
 * #666) — not a deliberate short/long-form distinction, just drift between
 * two copies of the same table (M6).
 */
export const STATUS_LABELS: Record<Story['status'], { text: string; color: string }> = {
  draft: { text: 'Черновик', color: '#6b7280' },
  script_generating: { text: 'Генерация сценария...', color: '#f59e0b' },
  script_ready: { text: 'Сценарий готов', color: '#10b981' },
  rendering: { text: 'Рендеринг видео...', color: '#f59e0b' },
  ready: { text: 'Готово', color: '#10b981' },
  error: { text: 'Ошибка', color: '#ef4444' },
};

const FALLBACK_COLOR = '#6b7280';

export function describeStatus(status: string): { text: string; color: string } {
  return STATUS_LABELS[status as Story['status']] ?? { text: status, color: FALLBACK_COLOR };
}

/**
 * What the worker is doing at a given progress value. The worker reports
 * 5 → 10 → 30 → 40 → 80 → 85 → 100 as it moves through the pipeline.
 */
export function describeStep(progress: number): string {
  if (progress < 10) return 'Задача принята в очередь';
  if (progress < 30) return 'ИИ пишет сценарий';
  if (progress < 40) return 'Озвучиваем кадры';
  if (progress < 80) return 'Собираем видео';
  if (progress < 100) return 'Готовим PDF и QR-код';
  return 'Готово';
}
