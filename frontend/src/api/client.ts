import axios from 'axios';
import type {
  ReviewListParams,
  TriggerReviewBody,
  AddRepoBody,
  UpdateRepoBody,
  ReviewListItem,
  ReviewDetail,
  PRDetailData,
  Repository,
  SettingItem,
  SettingsUpdateResult,
  SystemStatus,
  PollResult,
  CleanupPreview,
  CleanupResult,
  ApiResponse,
  PaginatedResponse,
} from '../types';

const api = axios.create({
  baseURL: '/api/v1',
});

export const reviewsApi = {
  list: (params: ReviewListParams) =>
    api.get<PaginatedResponse<ReviewListItem>>('/reviews', { params }),
  getById: (id: string) =>
    api.get<ApiResponse<ReviewDetail>>(`/reviews/${id}`),
  getByPR: (repo: string, prNumber: number) =>
    api.get<ApiResponse<PRDetailData>>(
      `/reviews/pr/${encodeURIComponent(repo)}/${prNumber}`
    ),
  getByCommit: (sha: string) =>
    api.get<ApiResponse<ReviewDetail>>(`/reviews/commit/${sha}`),
  trigger: (body: TriggerReviewBody) =>
    api.post<ApiResponse<{
      job_id: string;
      message: string;
      queue_position: number;
      review_id: string | null;
    }>>('/reviews/trigger', body),
  postComment: (id: string) =>
    api.post<ApiResponse<{
      posted: boolean;
      comment_url: string | null;
      action?: 'created' | 'updated';
    }>>(
      `/reviews/${id}/post-comment`
    ),
};

export const reposApi = {
  list: () => api.get<ApiResponse<Repository[]>>('/repos'),
  add: (body: AddRepoBody) =>
    api.post<ApiResponse<Repository>>('/repos', body),
  update: (id: string, body: UpdateRepoBody) =>
    api.patch<ApiResponse<Repository>>(`/repos/${id}`, body),
  remove: (id: string) => api.delete(`/repos/${id}`),
};

export const settingsApi = {
  getAll: () => api.get<ApiResponse<SettingItem[]>>('/settings'),
  update: (settings: Record<string, unknown>) =>
    api.patch<ApiResponse<SettingsUpdateResult>>('/settings', { settings }),
  reset: (key: string) =>
    api.post<ApiResponse<{ key: string; previous_value: unknown; restored_value: unknown; source: string }>>(
      `/settings/${encodeURIComponent(key)}/reset`
    ),
};

export const cleanupApi = {
  preview: (retentionDays?: number) =>
    api.get<ApiResponse<CleanupPreview>>('/cleanup/preview', {
      params: retentionDays ? { retention_days: retentionDays } : {},
    }),
  trigger: (retentionDays?: number) =>
    api.post<ApiResponse<CleanupResult>>(
      '/cleanup',
      retentionDays ? { retention_days: retentionDays } : {}
    ),
};

export const pollerApi = {
  triggerPoll: () => api.post<ApiResponse<PollResult>>('/poll'),
};

export const statusApi = {
  get: () => api.get<ApiResponse<SystemStatus>>('/status'),
};
