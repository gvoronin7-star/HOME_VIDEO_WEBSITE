import React, { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../components/AuthContext';
import { api } from '../services/api';
import { Story, StorySlide, Task } from '../types';
import toast from 'react-hot-toast';

/** Statuses that mean the backend is still working — worth polling. */
const POLLED_STATUSES: Story['status'][] = ['draft', 'script_generating', 'rendering'];

/** Statuses the user can launch generation from. */
const LAUNCHABLE_STATUSES: Story['status'][] = ['draft', 'script_ready', 'error'];

/**
 * What the worker is doing at a given progress value. The worker reports
 * 5 → 10 → 30 → 40 → 80 → 85 → 100 as it moves through the pipeline.
 */
/** Statuses in which the script may be edited — not while work is in flight. */
const EDITABLE_STATUSES: Story['status'][] = ['script_ready', 'ready', 'error'];

function sortedSlides(story: Story | null): StorySlide[] {
  return [...(story?.slides || [])].sort((a, b) => a.orderIndex - b.orderIndex);
}

function describeStep(progress: number): string {
  if (progress < 10) return 'Задача принята в очередь';
  if (progress < 30) return 'ИИ пишет сценарий';
  if (progress < 40) return 'Озвучиваем кадры';
  if (progress < 80) return 'Собираем видео';
  if (progress < 100) return 'Готовим PDF и QR-код';
  return 'Готово';
}

export default function StoryResultPage() {
  const { id } = useParams<{ id: string }>();
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [story, setStory] = useState<Story | null>(null);
  const [task, setTask] = useState<Task | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [draft, setDraft] = useState<StorySlide[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }
    loadStory();
  }, [id, isAuthenticated, navigate]);

  const loadStory = async () => {
    if (!id) return;
    try {
      const res = await api.getStory(id);
      setStory(res.data.story);
      // Never clobber in-progress edits with a background refresh.
      setIsEditing((editing) => {
        if (!editing) setDraft(sortedSlides(res.data.story));
        return editing;
      });
    } catch (error: any) {
      toast.error('История не найдена');
      navigate('/stories');
    } finally {
      setIsLoading(false);
    }
  };

  // Poll while work is in flight. 'draft' is included because creating a story
  // kicks off script generation in the background — without it a page opened
  // right after creation would never learn that the script arrived.
  useEffect(() => {
    if (!story || !POLLED_STATUSES.includes(story.status)) {
      return;
    }

    const interval = setInterval(async () => {
      try {
        const res = await api.getStoryStatus(story.id);

        // Merge on every response, not only when the status changes: videoUrl,
        // pdfUrl and qrCodeUrl are filled in *within* a status, so gating on a
        // status change meant finished artefacts never reached the page.
        setStory((prev) => (prev ? { ...prev, ...res.data.story } : null));
        setTask(res.data.task);

        if (res.data.story.status === 'ready') {
          toast.success('Видео готово!');
          clearInterval(interval);
          // Captions and durations were rewritten by the pipeline (narration sets
          // the timings), so pull the slides again.
          loadStory();
        } else if (res.data.story.status === 'error') {
          toast.error(res.data.task?.errorMessage || 'Генерация завершилась ошибкой');
          clearInterval(interval);
        }
      } catch {
        clearInterval(interval);
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [story?.id, story?.status]);

  const handleGenerate = async () => {
    if (!story) return;
    setIsGenerating(true);
    try {
      await api.generateStory(story.id);
      setStory((prev) => prev ? { ...prev, status: 'script_generating' } : null);
      setTask(null);
      toast.success('Генерация запущена!');
    } catch (error: any) {
      // The server explains itself — 503 means the queue is unreachable. Showing
      // its message beats a generic "error" the user cannot act on.
      toast.error(error.response?.data?.error?.message || 'Ошибка запуска генерации');
    } finally {
      setIsGenerating(false);
    }
  };

  // ===== Script editing =====

  const canEdit = story ? EDITABLE_STATUSES.includes(story.status) : false;

  const updateCaption = (slideId: string, caption: string) => {
    setDraft((prev) => prev.map((s) => (s.id === slideId ? { ...s, caption } : s)));
  };

  const updateDuration = (slideId: string, raw: string) => {
    const parsed = Number.parseInt(raw, 10);
    // Keep it inside the range the server validates, so saving cannot 422.
    const durationSeconds = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 30) : 1;
    setDraft((prev) => prev.map((s) => (s.id === slideId ? { ...s, durationSeconds } : s)));
  };

  const toggleKeyFrame = (slideId: string) => {
    setDraft((prev) =>
      prev.map((s) => (s.id === slideId ? { ...s, isKeyFrame: !s.isKeyFrame } : s))
    );
  };

  const moveSlide = (from: number, to: number) => {
    if (to < 0 || to >= draft.length) return;
    setDraft((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      // Renumber so orderIndex matches the visible order before saving.
      return next.map((s, i) => ({ ...s, orderIndex: i }));
    });
  };

  const cancelEditing = () => {
    setDraft(sortedSlides(story));
    setIsEditing(false);
  };

  const saveScript = async (): Promise<boolean> => {
    if (!story) return false;
    setIsSaving(true);
    try {
      await api.updateSlides(
        story.id,
        draft.map((s) => ({
          id: s.id,
          orderIndex: s.orderIndex,
          caption: s.caption || '',
          durationSeconds: s.durationSeconds,
          isKeyFrame: s.isKeyFrame,
        }))
      );
      setStory((prev) => (prev ? { ...prev, slides: draft } : null));
      return true;
    } catch (error: any) {
      const details = error.response?.data?.error?.details;
      toast.error(
        details?.[0]?.message ||
          error.response?.data?.error?.message ||
          'Не удалось сохранить сценарий'
      );
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveScript = async () => {
    if (await saveScript()) {
      toast.success('Сценарий сохранён');
      setIsEditing(false);
    }
  };

  const handleSaveAndRegenerate = async () => {
    if (!(await saveScript())) return;
    setIsEditing(false);
    await handleGenerate();
  };

  const handlePreview = async () => {
    if (!story) return;
    setIsPreviewing(true);
    try {
      const res = await api.previewStory(story.id);
      // Cache-bust: the preview file keeps the same name across renders.
      setPreviewUrl(`${res.data.previewUrl}?t=${Date.now()}`);
      toast.success('Превью готово');
    } catch (error: any) {
      toast.error(error.response?.data?.error?.message || 'Не удалось собрать превью');
    } finally {
      setIsPreviewing(false);
    }
  };

  const handleDelete = async () => {
    if (!story || !confirm('Удалить эту историю?')) return;
    try {
      await api.deleteStory(story.id);
      toast.success('История удалена');
      navigate('/stories');
    } catch {
      toast.error('Ошибка удаления');
    }
  };

  const copyLink = () => {
    if (story?.publicUrl) {
      navigator.clipboard.writeText(story.publicUrl);
      toast.success('Ссылка скопирована!');
    }
  };

  if (isLoading) {
    return <div className="loading">Загрузка...</div>;
  }

  if (!story) {
    return <div className="error">История не найдена</div>;
  }

  const statusLabels: Record<string, { text: string; color: string }> = {
    draft: { text: 'Черновик', color: '#666' },
    script_generating: { text: 'Генерация сценария...', color: '#f59e0b' },
    script_ready: { text: 'Сценарий готов', color: '#10b981' },
    rendering: { text: 'Рендеринг видео...', color: '#f59e0b' },
    ready: { text: 'Готово!', color: '#10b981' },
    error: { text: 'Ошибка', color: '#ef4444' },
  };

  const statusInfo = statusLabels[story.status] || { text: story.status, color: '#666' };

  return (
    <div className="story-result-page">
      <div className="story-header">
        <h1>{story.title}</h1>
        <span className="status-badge" style={{ backgroundColor: statusInfo.color }}>
          {statusInfo.text}
        </span>
      </div>

      {/* Real progress: the worker already reports 0-100 into the task. */}
      {(story.status === 'script_generating' || story.status === 'rendering') && (
        <div className="progress-block">
          <div
            className="progress-bar"
            role="progressbar"
            aria-valuenow={task ? task.progress : undefined}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Прогресс генерации"
          >
            <div
              className={`progress-fill${task ? '' : ' animate-pulse'}`}
              style={task ? { width: `${Math.max(task.progress, 2)}%` } : undefined}
            />
          </div>
          <div className="progress-meta">
            <span>{task ? describeStep(task.progress) : 'Запускаем...'}</span>
            {task && <span className="progress-percent">{task.progress}%</span>}
          </div>
        </div>
      )}

      {story.status === 'error' && task?.errorMessage && (
        <div className="alert alert-error" role="alert">
          <strong>Не удалось создать видео.</strong> {task.errorMessage}
        </div>
      )}

      <div className="story-content">
        {/* Video Player */}
        <div className="video-section">
          {story.videoUrl ? (
            <div className="video-wrapper">
              <video
                src={story.videoUrl}
                controls
                className="video-player"
                poster={story.slides?.[0]?.imageUrl}
              />
              <div className="video-actions">
                <a href={story.videoUrl} download className="btn btn-primary">
                  💾 Скачать MP4
                </a>
                {story.publicUrl && (
                  <button onClick={copyLink} className="btn btn-outline">
                    🔗 Копировать ссылку
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="video-placeholder">
              <div className="placeholder-icon">🎬</div>
              <p>
                {story.status === 'script_ready'
                  ? 'Сценарий готов — можно собирать видео'
                  : story.status === 'error'
                    ? 'Генерация завершилась ошибкой'
                    : 'Видео ещё не готово'}
              </p>
              {LAUNCHABLE_STATUSES.includes(story.status) && (
                <button
                  onClick={handleGenerate}
                  disabled={isGenerating}
                  className="btn btn-primary"
                >
                  {isGenerating
                    ? 'Запуск...'
                    : story.status === 'error'
                      ? '🔄 Повторить генерацию'
                      : '🚀 Запустить генерацию'}
                </button>
              )}

              {/* Full render takes minutes; this shows the first 4 frames in seconds. */}
              {canEdit && (
                <button
                  onClick={handlePreview}
                  disabled={isPreviewing}
                  className="btn btn-outline"
                >
                  {isPreviewing ? 'Собираем превью...' : '⚡ Быстрое превью'}
                </button>
              )}
            </div>
          )}

          {previewUrl && !story.videoUrl && (
            <div className="preview-block">
              <h4>Превью — первые кадры, без озвучки</h4>
              <video src={previewUrl} controls className="video-player" />
            </div>
          )}
        </div>

        {/* Info Sidebar */}
        <div className="story-info">
          {/* Script editor */}
          <section className="info-section">
            <div className="section-head">
              <h3>📝 Сценарий ({draft.length})</h3>
              {canEdit && !isEditing && draft.length > 0 && (
                <button onClick={() => setIsEditing(true)} className="btn btn-sm btn-outline">
                  Редактировать
                </button>
              )}
            </div>

            {!isEditing && (
              <div className="slides-preview">
                {draft.map((slide) => (
                  <div key={slide.id} className="slide-preview-item">
                    <img
                      src={slide.imageUrl}
                      alt={slide.caption || `Кадр ${slide.orderIndex + 1}`}
                      className="slide-thumb"
                    />
                    <p className="slide-caption">{slide.caption || '...'}</p>
                    {slide.isKeyFrame && <span className="key-tag">⭐ Ключевой</span>}
                  </div>
                ))}
              </div>
            )}

            {isEditing && (
              <>
                <p className="section-hint">
                  Длительность — это минимум: если фраза звучит дольше, кадр покажем столько,
                  сколько звучит озвучка.
                </p>

                <div className="slide-editor">
                  {draft.map((slide, index) => (
                    <div key={slide.id} className="slide-edit-row">
                      <div className="slide-edit-head">
                        <img
                          src={slide.imageUrl}
                          alt={`Кадр ${index + 1}`}
                          className="slide-edit-thumb"
                        />
                        <div className="slide-edit-controls">
                          <button
                            onClick={() => moveSlide(index, index - 1)}
                            disabled={index === 0}
                            className="btn btn-icon"
                            aria-label={`Переместить кадр ${index + 1} выше`}
                          >
                            ▲
                          </button>
                          <button
                            onClick={() => moveSlide(index, index + 1)}
                            disabled={index === draft.length - 1}
                            className="btn btn-icon"
                            aria-label={`Переместить кадр ${index + 1} ниже`}
                          >
                            ▼
                          </button>
                          <button
                            onClick={() => toggleKeyFrame(slide.id)}
                            className={`btn btn-icon ${slide.isKeyFrame ? 'btn-key' : ''}`}
                            aria-label={
                              slide.isKeyFrame
                                ? `Снять отметку «ключевой» с кадра ${index + 1}`
                                : `Отметить кадр ${index + 1} ключевым`
                            }
                            aria-pressed={slide.isKeyFrame}
                          >
                            ⭐
                          </button>
                        </div>
                      </div>

                      <label className="sr-only" htmlFor={`caption-${slide.id}`}>
                        Текст кадра {index + 1}
                      </label>
                      <textarea
                        id={`caption-${slide.id}`}
                        value={slide.caption}
                        onChange={(e) => updateCaption(slide.id, e.target.value)}
                        className="form-input slide-edit-caption"
                        rows={3}
                        maxLength={500}
                        placeholder="Текст, который прозвучит на этом кадре"
                      />

                      <div className="slide-edit-duration">
                        <label htmlFor={`duration-${slide.id}`}>Минимум, сек</label>
                        <input
                          id={`duration-${slide.id}`}
                          type="number"
                          min={1}
                          max={30}
                          value={slide.durationSeconds}
                          onChange={(e) => updateDuration(slide.id, e.target.value)}
                          className="form-input"
                        />
                      </div>
                    </div>
                  ))}
                </div>

                <div className="slide-editor-actions">
                  <button
                    onClick={handleSaveScript}
                    disabled={isSaving}
                    className="btn btn-outline btn-block"
                  >
                    {isSaving ? 'Сохраняем...' : '💾 Сохранить'}
                  </button>
                  <button
                    onClick={handleSaveAndRegenerate}
                    disabled={isSaving || isGenerating}
                    className="btn btn-primary btn-block"
                  >
                    {isSaving || isGenerating ? 'Запускаем...' : '💾 Сохранить и пересобрать видео'}
                  </button>
                  <button
                    onClick={cancelEditing}
                    disabled={isSaving}
                    className="btn btn-block"
                  >
                    Отменить
                  </button>
                </div>
              </>
            )}
          </section>

          {/* Downloads */}
          <section className="info-section">
            <h3>📦 Экспорт</h3>
            <div className="export-buttons">
              {story.pdfUrl && (
                <a href={story.pdfUrl} download className="btn btn-outline btn-block">
                  📄 Скачать PDF-альбом
                </a>
              )}
              {story.qrCodeUrl && (
                <div className="qr-section">
                  <img src={story.qrCodeUrl} alt="QR Code" className="qr-image" />
                  <p>Отсканируйте, чтобы открыть видео</p>
                </div>
              )}
              {story.publicUrl && (
                <div className="share-buttons">
                  <button onClick={copyLink} className="btn btn-outline btn-block">
                    🔗 Скопировать ссылку
                  </button>
                  <a
                    href={`https://vk.com/share.php?url=${encodeURIComponent(story.publicUrl)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-outline btn-block"
                  >
                    📱 Поделиться ВКонтакте
                  </a>
                  <a
                    href={`https://t.me/share/url?url=${encodeURIComponent(story.publicUrl)}&text=${encodeURIComponent(story.title)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-outline btn-block"
                  >
                    ✈️ Отправить в Telegram
                  </a>
                </div>
              )}
            </div>
          </section>

          {/* Danger Zone */}
          <section className="info-section">
            <button onClick={handleDelete} className="btn btn-danger btn-block">
              🗑 Удалить историю
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}