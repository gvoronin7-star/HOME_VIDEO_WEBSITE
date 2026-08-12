import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../services/api';
import { Story } from '../types';

export default function SharePage() {
  const { id } = useParams<{ id: string }>();
  const [story, setStory] = useState<Story | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    api.getPublicStory(id)
      .then((res) => setStory(res.data.story as Story))
      .catch(() => setError('История не найдена или ещё не готова'))
      .finally(() => setIsLoading(false));
  }, [id]);

  if (isLoading) {
    return (
      <div className="share-page">
        <div className="loading">Загрузка...</div>
      </div>
    );
  }

  if (error || !story) {
    return (
      <div className="share-page">
        <div className="share-error">
          <div className="error-icon">😕</div>
          <h2>{error || 'История не найдена'}</h2>
          <p>Возможно, видео ещё готовится или ссылка устарела</p>
        </div>
      </div>
    );
  }

  return (
    <div className="share-page">
      <div className="share-card">
        <h1 className="share-title">{story.title}</h1>
        {story.template && (
          <p className="share-template">{story.template.name}</p>
        )}

        {story.videoUrl ? (
          <div className="share-video">
            <video
              src={story.videoUrl}
              controls
              className="share-video-player"
              poster={story.slides?.[0]?.imageUrl}
              autoPlay
            />
          </div>
        ) : (
          <div className="share-placeholder">
            <div className="placeholder-icon">🎬</div>
            <p>Видео готовится... Скоро здесь будет готовый ролик!</p>
          </div>
        )}

        {story.slides && story.slides.length > 0 && (
          <div className="share-slides">
            <h3>Кадры из видео</h3>
            <div className="share-slides-grid">
              {story.slides.map((slide, index) => (
                <div key={slide.id} className="share-slide-item">
                  <img
                    src={slide.imageUrl}
                    // The caption describes the frame, so it is the best alt text
                    // available; fall back to the position when it is empty.
                    alt={slide.caption || `Кадр ${index + 1} из истории «${story.title}»`}
                    className="share-slide-img"
                  />
                  {slide.caption && <p className="share-slide-caption">{slide.caption}</p>}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="share-footer">
          <p className="share-made-with">Создано с ❤️ в Family Cinema</p>
        </div>
      </div>
    </div>
  );
}