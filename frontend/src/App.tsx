import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import Layout from './components/Layout';
import HomePage from './pages/HomePage';
import CreateStoryPage from './pages/CreateStoryPage';
import StoryResultPage from './pages/StoryResultPage';
import MyStoriesPage from './pages/MyStoriesPage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import SharePage from './pages/SharePage';
import { AuthProvider } from './components/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';

function App() {
  return (
    <AuthProvider>
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 3000,
          style: {
            borderRadius: '12px',
            background: '#333',
            color: '#fff',
            fontSize: '14px',
          },
        }}
      />
      <Layout>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route
            path="/create"
            element={
              <ProtectedRoute>
                <CreateStoryPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/stories"
            element={
              <ProtectedRoute>
                <MyStoriesPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/stories/:id"
            element={
              <ProtectedRoute>
                <StoryResultPage />
              </ProtectedRoute>
            }
          />
          <Route path="/share/:id" element={<SharePage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </AuthProvider>
  );
}

export default App;
