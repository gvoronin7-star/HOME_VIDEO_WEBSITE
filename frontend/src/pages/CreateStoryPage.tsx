import React, { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { Template, UploadedFile, VoiceProfile } from '../types';
import { useDropzone } from 'react-dropzone';
import toast from 'react-hot-toast';

export default function CreateStoryPage() {
  const navigate = useNavigate();

  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [voices, setVoices] = useState<VoiceProfile[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string>('');
  const [tone, setTone] = useState<string>('warm');
  const [voiceGender, setVoiceGender] = useState<'male' | 'female'>('female');
  const [voiceProfileId, setVoiceProfileId] = useState<string>('');
  const [title, setTitle] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadPercent, setUploadPercent] = useState(0);

  useEffect(() => {
    api
      .getTemplates()
      .then((res) => {
        setTemplates(res.data.templates);
        if (res.data.templates.length > 0) {
          setSelectedTemplate(res.data.templates[0].id);
        }
      })
      .catch(() => toast.error('Не удалось загрузить шаблоны'));

    // Voice profiles are optional garnish — a failure here must not block creation.
    api
      .getVoices()
      .then((res) => {
        setVoices(res.data.voices);
        if (res.data.voices.length > 0) {
          setVoiceProfileId(res.data.voices[0].id);
        }
      })
      .catch(() => setVoices([]));
  }, []);

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      const newFiles = acceptedFiles.map((file, i) => ({
        id: `file-${Date.now()}-${i}`,
        file,
        preview: URL.createObjectURL(file),
        orderIndex: files.length + i,
        isKeyFrame: files.length + i === 0,
      }));

      if (files.length + newFiles.length > 20) {
        toast.error('Максимум 20 фото');
        return;
      }

      setFiles((prev) => [...prev, ...newFiles]);
    },
    [files.length],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/png': ['.png'],
      'image/webp': ['.webp'],
    },
    maxSize: 10 * 1024 * 1024,
    maxFiles: 20,
  });

  const removeFile = (id: string) => {
    setFiles((prev) => {
      const file = prev.find((f) => f.id === id);
      if (file) URL.revokeObjectURL(file.preview);
      return prev.filter((f) => f.id !== id).map((f, i) => ({ ...f, orderIndex: i }));
    });
  };

  const moveFile = (fromIndex: number, toIndex: number) => {
    const newFiles = [...files];
    const [moved] = newFiles.splice(fromIndex, 1);
    newFiles.splice(toIndex, 0, moved);
    setFiles(newFiles.map((f, i) => ({ ...f, orderIndex: i, isKeyFrame: i === 0 })));
  };

  const toggleKeyFrame = (id: string) => {
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, isKeyFrame: !f.isKeyFrame } : f)));
  };

  const handleSubmit = async () => {
    if (files.length === 0) {
      toast.error('Загрузите хотя бы одно фото');
      return;
    }
    if (!selectedTemplate) {
      toast.error('Выберите шаблон');
      return;
    }

    setIsUploading(true);
    setUploadPercent(0);
    try {
      const formData = new FormData();
      files.forEach((f) => formData.append('photos', f.file));
      formData.append('templateId', selectedTemplate);
      formData.append('tone', tone);
      // A specific named voice, when one was picked from the catalogue, is a
      // stronger signal than gender alone — the server derives voiceGender
      // from it. Otherwise (no profiles loaded) fall back to the plain
      // gender picker.
      if (voices.length > 0 && voiceProfileId) {
        formData.append('voiceProfileId', voiceProfileId);
      } else {
        formData.append('voiceGender', voiceGender);
      }
      if (title) formData.append('title', title);

      const res = await api.createStory(formData, setUploadPercent);
      toast.success('История создана! Начинаем генерацию...');
      navigate(`/stories/${res.data.story.id}`);
    } catch (error: any) {
      const message = error.response?.data?.error?.message || 'Ошибка создания истории';
      toast.error(message);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="create-story-page">
      <h1 className="page-title">Создать историю</h1>
      <p className="page-subtitle">
        Шаг 1: Загрузите фото → Шаг 2: Выберите шаблон → Шаг 3: Получите видео
      </p>

      <div className="create-layout">
        <div className="create-main">
          {/* Photo Upload */}
          <section className="section">
            <h2>📸 Загрузите фотографии</h2>
            <p className="section-hint">До 20 фото. JPG, PNG, WebP. До 10 МБ на файл.</p>

            <div
              {...getRootProps()}
              className={`dropzone ${isDragActive ? 'dropzone-active' : ''}`}
            >
              <input {...getInputProps()} />
              {isDragActive ? (
                <p>Отпустите фото для загрузки...</p>
              ) : (
                <div className="dropzone-content">
                  <span className="dropzone-icon">📁</span>
                  <p>Перетащите фото сюда или нажмите для выбора</p>
                </div>
              )}
            </div>

            {files.length > 0 && (
              <div className="photo-grid">
                {files.map((file, index) => (
                  <div key={file.id} className="photo-card">
                    <div className="photo-order" aria-hidden="true">
                      {index + 1}
                    </div>
                    <img
                      src={file.preview}
                      alt={`Загруженное фото ${index + 1} из ${files.length}: ${file.file.name}`}
                      className="photo-preview"
                    />
                    <div className="photo-actions">
                      {/* Emoji alone is not an accessible name — aria-label carries it. */}
                      <button
                        onClick={() => toggleKeyFrame(file.id)}
                        className={`btn btn-icon ${file.isKeyFrame ? 'btn-key' : ''}`}
                        aria-label={
                          file.isKeyFrame
                            ? `Снять отметку «ключевой» с фото ${index + 1}`
                            : `Отметить фото ${index + 1} ключевым`
                        }
                        aria-pressed={file.isKeyFrame}
                      >
                        <span aria-hidden="true">⭐</span>
                      </button>
                      <button
                        onClick={() => index > 0 && moveFile(index, index - 1)}
                        disabled={index === 0}
                        className="btn btn-icon"
                        aria-label={`Переместить фото ${index + 1} назад`}
                      >
                        <span aria-hidden="true">◀</span>
                      </button>
                      <button
                        onClick={() => index < files.length - 1 && moveFile(index, index + 1)}
                        disabled={index === files.length - 1}
                        className="btn btn-icon"
                        aria-label={`Переместить фото ${index + 1} вперёд`}
                      >
                        <span aria-hidden="true">▶</span>
                      </button>
                      <button
                        onClick={() => removeFile(file.id)}
                        className="btn btn-icon btn-danger"
                        aria-label={`Удалить фото ${index + 1}`}
                      >
                        <span aria-hidden="true">✕</span>
                      </button>
                    </div>
                    {file.isKeyFrame && <span className="key-badge">Ключевой</span>}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="create-sidebar">
          {/* Template Selection */}
          <section className="section">
            <h2>🎬 Выберите шаблон</h2>
            <div className="template-list">
              {templates.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setSelectedTemplate(t.id)}
                  className={`template-option ${selectedTemplate === t.id ? 'selected' : ''}`}
                >
                  <strong>{t.name}</strong>
                  <span className="template-desc">{t.description}</span>
                  <span className="template-tone-badge">{t.tone}</span>
                </button>
              ))}
            </div>
          </section>

          {/* Tone & Voice */}
          <section className="section">
            <h2>🎭 Настроение</h2>
            <select value={tone} onChange={(e) => setTone(e.target.value)} className="form-select">
              <option value="warm">Тёплый</option>
              <option value="ironic">Ироничный</option>
              <option value="solemn">Торжественный</option>
            </select>

            <h2 className="mt-3">🎤 Голос озвучки</h2>
            {voices.length > 0 ? (
              <select
                value={voiceProfileId}
                onChange={(e) => setVoiceProfileId(e.target.value)}
                className="form-select"
                aria-label="Голос озвучки"
              >
                {/* Real profiles from the server, grouped so the mood is visible.
                    Each option is the profile's own id — picking one selects that
                    exact voice, not just its gender. */}
                <optgroup label="Женские">
                  {voices
                    .filter((v) => v.gender === 'female')
                    .map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                </optgroup>
                <optgroup label="Мужские">
                  {voices
                    .filter((v) => v.gender === 'male')
                    .map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                </optgroup>
              </select>
            ) : (
              <select
                value={voiceGender}
                onChange={(e) => setVoiceGender(e.target.value as 'male' | 'female')}
                className="form-select"
                aria-label="Голос озвучки"
              >
                <option value="female">Женский</option>
                <option value="male">Мужской</option>
              </select>
            )}
            <p className="section-hint">
              {voices.length > 0
                ? 'Выбранный голос звучит именно так, независимо от настроения истории.'
                : 'Характер голоса подбирается под выбранное настроение истории.'}
            </p>
          </section>

          {/* Title */}
          <section className="section">
            <h2>📝 Название</h2>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Например: Наше лето на даче"
              className="form-input"
            />
          </section>

          {/* Submit */}
          <button
            onClick={handleSubmit}
            disabled={isUploading || files.length === 0}
            className="btn btn-primary btn-block btn-lg"
          >
            {isUploading ? 'Загрузка...' : '🚀 Создать историю'}
          </button>

          {/* Twenty 10 MB photos take a while — show real progress, not a frozen button. */}
          {isUploading && (
            <div className="upload-progress">
              <div className="upload-progress-label">
                <span>
                  {uploadPercent < 100
                    ? `Загружаем фото — ${files.length} шт.`
                    : 'Обрабатываем на сервере...'}
                </span>
                <span className="progress-percent">{uploadPercent}%</span>
              </div>
              <div
                className="progress-bar"
                role="progressbar"
                aria-valuenow={uploadPercent}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Прогресс загрузки фотографий"
              >
                <div
                  className="progress-fill"
                  style={{ width: `${Math.max(uploadPercent, 2)}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
