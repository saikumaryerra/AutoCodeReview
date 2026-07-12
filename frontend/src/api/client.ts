import axios from 'axios';
import type {
  ReviewListParams,
  TriggerReviewBody,
  AddRepoBody,
  UpdateRepoBody,
  ReviewListItem,
  ReviewDetail,
  PRDetailData,
  PRListItem,
  PRListParams,
  Repository,
  RepoSettingItem,
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
  // Prefix with Vite's base so requests go to <base>api/v1 (e.g.
  // /autocodereview/api/v1); the reverse proxy strips the base back to /api/v1.
  baseURL: `${import.meta.env.BASE_URL}api/v1`,
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

export const prsApi = {
  list: (params: PRListParams) =>
    api.get<PaginatedResponse<PRListItem>>('/prs', { params }),
};

export const reposApi = {
  list: () => api.get<ApiResponse<Repository[]>>('/repos'),
  add: (body: AddRepoBody) =>
    api.post<ApiResponse<Repository>>('/repos', body),
  update: (id: string, body: UpdateRepoBody) =>
    api.patch<ApiResponse<Repository>>(`/repos/${id}`, body),
  remove: (id: string) => api.delete(`/repos/${id}`),
  getStandards: (id: string) =>
    api.get<ApiResponse<{ repo_full_name: string; coding_standards: string | null }>>(`/repos/${id}/coding-standards`),
  updateStandards: (id: string, coding_standards: string) =>
    api.put<ApiResponse<{ repo_full_name: string; coding_standards: string }>>(`/repos/${id}/coding-standards`, { coding_standards }),
  regenerateStandards: (id: string) =>
    api.post<ApiResponse<{ repo_full_name: string; coding_standards: string }>>(`/repos/${id}/coding-standards/regenerate`),
  getSettings: (id: string) =>
    api.get<ApiResponse<RepoSettingItem[]>>(`/repos/${id}/settings`),
  setSetting: (id: string, key: string, value: unknown) =>
    api.put<ApiResponse<{ key: string; repo_value: unknown; effective_value: unknown; is_overridden: boolean }>>(
      `/repos/${id}/settings/${encodeURIComponent(key)}`, { value },
    ),
  resetSetting: (id: string, key: string) =>
    api.delete<ApiResponse<{ key: string; is_overridden: boolean; effective_value: unknown }>>(
      `/repos/${id}/settings/${encodeURIComponent(key)}`,
    ),
  resetAllSettings: (id: string) =>
    api.delete<ApiResponse<{ reset: boolean }>>(`/repos/${id}/settings`),
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
