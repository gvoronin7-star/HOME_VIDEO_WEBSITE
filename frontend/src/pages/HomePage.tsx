import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../components/AuthContext';

export default function HomePage() {
  const { isAuthenticated } = useAuth();

  return (
    <div className="home-page">
      <section className="hero">
        <h1 className="hero-title">
          Превратите семейные фото
          <br />
          <span className="gradient-text">в тёплые видео с ИИ</span>
        </h1>
        <p className="hero-subtitle">
          Загрузите фотографии, выберите шаблон — и ИИ создаст трогательный сценарий, озвучит и
          смонтирует видео для вашей семьи
        </p>

        <div className="hero-actions">
          {isAuthenticated ? (
            <Link to="/create" className="btn btn-primary btn-lg">
              Создать историю
            </Link>
          ) : (
            <>
              <Link to="/register" className="btn btn-primary btn-lg">
                Начать бесплатно
              </Link>
              <Link to="/login" className="btn btn-outline btn-lg">
                У меня есть аккаунт
              </Link>
            </>
          )}
        </div>

        <div className="steps">
          <div className="step-card">
            <div className="step-number">1</div>
            <h3>Загрузите фото</h3>
            <p>До 20 фото в форматах JPG, PNG, WebP. Перетащите для сортировки.</p>
          </div>
          <div className="step-arrow">→</div>
          <div className="step-card">
            <div className="step-number">2</div>
            <h3>Выберите шаблон</h3>
            <p>«День на даче», «Первый день в школе», «Переезд» и другие.</p>
          </div>
          <div className="step-arrow">→</div>
          <div className="step-card">
            <div className="step-number">3</div>
            <h3>Получите видео</h3>
            <p>Скачайте MP4, PDF-альбом и поделитесь с близкими.</p>
          </div>
        </div>
      </section>

      <section className="features">
        <h2 className="section-title">Что вы получите</h2>
        <div className="features-grid">
          <div className="feature-card">
            <div className="feature-icon">🤖</div>
            <h3>ИИ-сценарий</h3>
            <p>Нейросеть напишет тёплый текст для каждого кадра с учётом выбранного настроения.</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">🎤</div>
            <h3>Озвучка</h3>
            <p>Выберите голос: мужской или женский, тёплый или спокойный.</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">🎬</div>
            <h3>Готовое видео</h3>
            <p>MP4 в Full HD с плавными переходами и текстом на кадрах.</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">📸</div>
            <h3>PDF-альбом</h3>
            <p>Красивый альбом с фото и текстом сценария для печати.</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">📱</div>
            <h3>QR-код</h3>
            <p>Отсканируйте QR-код, чтобы поделиться видео с родными.</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">🔗</div>
            <h3>Публикация</h3>
            <p>Скопируйте ссылку и отправьте её в мессенджеры.</p>
          </div>
        </div>
      </section>

      <section className="templates-preview">
        <h2 className="section-title">Популярные шаблоны</h2>
        <div className="templates-grid">
          <div className="template-card">
            <div className="template-emoji">🏡</div>
            <h3>День на даче</h3>
            <p>Тёплые моменты загородной жизни</p>
            <span className="template-tone">тёплый</span>
          </div>
          <div className="template-card">
            <div className="template-emoji">🎒</div>
            <h3>Первый день в школе</h3>
            <p>Волнующий праздник знаний</p>
            <span className="template-tone tone-solemn">торжественный</span>
          </div>
          <div className="template-card">
            <div className="template-emoji">📦</div>
            <h3>Переезд</h3>
            <p>Новая глава в жизни семьи</p>
            <span className="template-tone">тёплый</span>
          </div>
          <div className="template-card">
            <div className="template-emoji">🎂</div>
            <h3>День рождения</h3>
            <p>Торт, свечи, подарки</p>
            <span className="template-tone">радостный</span>
          </div>
        </div>
      </section>
    </div>
  );
}
