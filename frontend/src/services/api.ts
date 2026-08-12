import axios, { AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import type {
  ApiResponse,
  AuthResponse,
  Story,
  StoryStatus,
  Template,
  VoiceProfile,
} from '../types';

const API_BASE = '/api';

class ApiService {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: API_BASE,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Add auth interceptor
    this.client.interceptors.request.use((config: InternalAxiosRequestConfig) => {
      const token = localStorage.getItem('token');
      if (token && config.headers) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    });

    // Handle 401 errors
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response?.status === 401) {
          localStorage.removeItem('token');
          localStorage.removeItem('user');
          if (window.location.pathname !== '/login') {
            window.location.href = '/login';
          }
        }
        return Promise.reject(error);
      }
    );
  }

  // === Auth ===
  async register(email: string, password: string, name?: string) {
    const { data } = await this.client.post<ApiResponse<AuthResponse>>('/auth/register', {
      email,
      password,
      name,
    });
    return data;
  }

  async login(email: string, password: string) {
    const { data } = await this.client.post<ApiResponse<AuthResponse>>('/auth/login', {
      email,
      password,
    });
    return data;
  }

  async getMe() {
    const { data } = await this.client.get<ApiResponse<{ user: any }>>('/auth/me');
    return data;
  }

  // === Templates ===
  async getTemplates() {
    const { data } = await this.client.get<ApiResponse<{ templates: Template[] }>>('/templates');
    return data;
  }

  // === Voices ===
  async getVoices() {
    const { data } = await this.client.get<ApiResponse<{ voices: VoiceProfile[] }>>('/voices');
    return data;
  }

  // === Stories ===
  async getStories() {
    const { data } = await this.client.get<ApiResponse<{ stories: Story[] }>>('/stories');
    return data;
  }

  async getStory(id: string) {
    const { data } = await this.client.get<ApiResponse<{ story: Story }>>(`/stories/${id}`);
    return data;
  }

  async getStoryStatus(id: string) {
    const { data } = await this.client.get<ApiResponse<StoryStatus>>(`/stories/${id}/status`);
    return data;
  }

  /**
   * @param onProgress receives 0-100 as the photos upload. Twenty 10 MB files
   *   take a while, and without this the UI looks frozen.
   */
  async createStory(formData: FormData, onProgress?: (percent: number) => void) {
    const { data } = await this.client.post<ApiResponse<{ story: Story }>>('/stories', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (event) => {
        if (!onProgress) return;
        // `total` is absent on some browsers/proxies — report nothing rather than NaN.
        if (typeof event.total === 'number' && event.total > 0) {
          onProgress(Math.round((event.loaded / event.total) * 100));
        }
      },
    });
    return data;
  }

  async updateSlides(storyId: string, slides: Array<{
    id: string;
    orderIndex: number;
    caption: string;
    durationSeconds: number;
    isKeyFrame: boolean;
  }>) {
    const { data } = await this.client.put<ApiResponse<{ message: string }>>(
      `/stories/${storyId}/slides`,
      { slides }
    );
    return data;
  }

  /** Fast visual check of the first slides — rendered without narration. */
  async previewStory(storyId: string) {
    const { data } = await this.client.post<ApiResponse<{ previewUrl: string; slidesCount: number }>>(
      `/stories/${storyId}/preview`,
      undefined,
      // Rendering happens inline; allow more than the default timeout.
      { timeout: 120000 }
    );
    return data;
  }

  async generateStory(storyId: string) {
    const { data } = await this.client.post<ApiResponse<{ message: string; storyId: string; status: string }>>(
      `/stories/${storyId}/generate`
    );
    return data;
  }

  async deleteStory(storyId: string) {
    const { data } = await this.client.delete<ApiResponse<{ message: string }>>(`/stories/${storyId}`);
    return data;
  }

  // === Share ===
  async getPublicStory(id: string) {
    const { data } = await this.client.get<ApiResponse<{ story: Partial<Story> }>>(`/share/${id}`);
    return data;
  }
}

export const api = new ApiService();