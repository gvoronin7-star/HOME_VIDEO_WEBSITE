import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';

interface LayoutProps {
  children: React.ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const { isAuthenticated, user, logout } = useAuth();
  const location = useLocation();

  const isActive = (path: string) => location.pathname === path;

  return (
    <div className="app-layout">
      <a href="#main" className="skip-link">
        Перейти к содержимому
      </a>

      <header className="header">
        <div className="container header-content">
          <Link to="/" className="logo">
            <span className="logo-icon" aria-hidden="true">
              🎬
            </span>
            <span className="logo-text">Family Cinema</span>
          </Link>

          <nav className="nav" aria-label="Основная навигация">
            <Link to="/" className={`nav-link ${isActive('/') ? 'active' : ''}`}>
              Главная
            </Link>
            {isAuthenticated ? (
              <>
                <Link to="/create" className={`nav-link ${isActive('/create') ? 'active' : ''}`}>
                  Создать историю
                </Link>
                <Link to="/stories" className={`nav-link ${isActive('/stories') ? 'active' : ''}`}>
                  Мои истории
                </Link>
                <div className="user-menu">
                  <span className="user-name">{user?.name || user?.email}</span>
                  <button onClick={logout} className="btn btn-sm btn-outline">
                    Выйти
                  </button>
                </div>
              </>
            ) : (
              <>
                <Link to="/login" className={`nav-link ${isActive('/login') ? 'active' : ''}`}>
                  Войти
                </Link>
                <Link to="/register" className="btn btn-primary btn-sm">
                  Регистрация
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>

      <main id="main" className="main-content container">
        {children}
      </main>

      <footer className="footer">
        <div className="container footer-content">
          <p>
            © {new Date().getFullYear()} Family Cinema. Создано с{' '}
            <span aria-label="любовью">❤️</span> для семейных воспоминаний.
          </p>
          <div className="footer-links">
            <Link to="/">Главная</Link>
            <span className="footer-sep">·</span>
            <Link to="/create">Создать</Link>
            <span className="footer-sep">·</span>
            <Link to="/stories">Мои истории</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
