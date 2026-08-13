export interface User {
  id: string;
  email: string;
  name: string;
}

export interface Template {
  id: string;
  name: string;
  description: string;
  tone: string;
  defaultDurationSeconds: number;
}

export interface StorySlide {
  id: string;
  storyId: string;
  imageUrl: string;
  orderIndex: number;
  caption: string;
  durationSeconds: number;
  isKeyFrame: boolean;
  createdAt: string;
}

export interface Story {
  id: string;
  userId: string;
  title: string;
  templateId: string;
  status: 'draft' | 'script_generating' | 'script_ready' | 'rendering' | 'ready' | 'error';
  tone: string;
  voiceGender: 'male' | 'female';
  scriptText: string | null;
  videoUrl: string | null;
  pdfUrl: string | null;
  qrCodeUrl: string | null;
  publicUrl: string | null;
  createdAt: string;
  updatedAt: string;
  template?: Template;
  slides?: StorySlide[];
}

export type TaskStatus = 'pending' | 'queued' | 'processing' | 'completed' | 'failed';

/** Generation task. The backend tracks real progress here; the UI reads it. */
export interface Task {
  id: string;
  status: TaskStatus;
  /** 0-100, written by the worker as it moves through the pipeline. */
  progress: number;
  errorMessage: string | null;
  resultData: Record<string, unknown> | null;
  createdAt: string;
  completedAt: string | null;
}

/** Shape of GET /stories/:id/status — carries the task, not just the story. */
export interface StoryStatus {
  story: Partial<Story>;
  task: Task | null;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: {
    message: string;
    details?: Array<{ path: string; message: string }>;
  };
}

export interface AuthResponse {
  user: User;
  token: string;
}

export interface UploadedFile {
  id: string;
  file: File;
  preview: string;
  orderIndex: number;
  isKeyFrame: boolean;
}

export interface VoiceProfile {
  id: string;
  name: string;
  gender: 'male' | 'female';
  emotion: string;
  previewUrl: string | null;
}
