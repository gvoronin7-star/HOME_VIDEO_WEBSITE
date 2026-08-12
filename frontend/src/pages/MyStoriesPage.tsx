import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../components/AuthContext';
import { api } from '../services/api';
import { Story } from '../types';
import toast from 'react-hot-toast';

export default function MyStoriesPage() {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [stories, setStories] = useState<Story[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }
    loadStories();
  }, [isAuthenticated, navigate]);

  const loadStories = async () => {
    try {
      const res = await api.getStories();
      setStories(res.data.stories);
    } catch (error: any) {
      toast.error('Не удалось загрузить истории');
    } finally {
      setIsLoading(false);
    }
  };

  const statusLabels: Record<string, { text: string; color: string }> = {
    draft: { text: 'Черновик', color: '#6b7280' },
    script_generating: { text: 'Генерация...', color: '#f59e0b' },
    script_ready: { text: 'Сценарий готов', color: '#10b981' },
    rendering: { text: 'Рендеринг...', color: '#f59e0b' },
    ready: { text: 'Готово', color: '#10b981' },
    error: { text: 'Ошибка', color: '#ef4444' },
  };

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
            const status = statusLabels[story.status] || { text: story.status, color: '#666' };
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