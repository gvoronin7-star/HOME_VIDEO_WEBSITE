import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../services/api';
import { Story } from '../types';
import { describeStatus } from '../utils/storyStatus';
import toast from 'react-hot-toast';

export default function MyStoriesPage() {
  const [stories, setStories] = useState<Story[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadStories = async () => {
    try {
      const res = await api.getStories();
      setStories(res.data.stories);
    } catch {
      toast.error('Не удалось загрузить истории');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadStories();
  }, []);

  if (isLoading) {
    return <div className="loading">Загрузка...</div>;
  }

  return (
    <div className="my-stories-page">
      <div className="page-header">
        <h1>Мои истории</h1>
        <Link to="/create" className="btn btn-primary">
          ➕ Создать новую
        </Link>
      </div>

      {stories.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">📸</div>
          <h2>У вас пока нет историй</h2>
          <p>Загрузите фото, и ИИ создаст видео с тёплым сценарием и озвучкой</p>
          <Link to="/create" className="btn btn-primary btn-lg">
            Создать первую историю
          </Link>
        </div>
      ) : (
        <div className="stories-grid">
          {stories.map((story) => {
            const status = describeStatus(story.status);
            return (
              <Link to={`/stories/${story.id}`} key={story.id} className="story-card-link">
                <div className="story-card">
                  <div className="story-card-thumb">
                    {story.slides && story.slides.length > 0 ? (
                      <img
                        src={story.slides[0].imageUrl}
                        alt={story.title}
                        className="card-thumb-img"
                      />
                    ) : (
                      <div className="card-thumb-placeholder">🎬</div>
                    )}
                    <span className="card-status" style={{ backgroundColor: status.color }}>
                      {status.text}
                    </span>
                  </div>
                  <div className="story-card-body">
                    <h3>{story.title}</h3>
                    <p className="card-template">{story.template?.name || 'Без шаблона'}</p>
                    <div className="card-meta">
                      <span>{story.slides?.length || 0} фото</span>
                      <span>{new Date(story.createdAt).toLocaleDateString('ru-RU')}</span>
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
