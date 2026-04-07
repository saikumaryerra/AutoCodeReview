import { useQuery } from '@tanstack/react-query';
import { reviewsApi } from '../api/client';
import type { ReviewListParams } from '../types';

export function useReviews(params: ReviewListParams = {}) {
  return useQuery({
    queryKey: ['reviews', params],
    queryFn: async () => {
      const res = await reviewsApi.list(params);
      return res.data;
    },
  });
}

export function useReview(id: string) {
  return useQuery({
    queryKey: ['review', id],
    queryFn: async () => {
      const res = await reviewsApi.getById(id);
      return res.data.data;
    },
    enabled: !!id,
  });
}

export function usePRReviews(repo: string, prNumber: number) {
  return useQuery({
    queryKey: ['pr-reviews', repo, prNumber],
    queryFn: async () => {
      const res = await reviewsApi.getByPR(repo, prNumber);
      return res.data.data;
    },
    enabled: !!repo && !!prNumber,
  });
}

export function useCommitReview(sha: string) {
  return useQuery({
    queryKey: ['commit-review', sha],
    queryFn: async () => {
      const res = await reviewsApi.getByCommit(sha);
      return res.data.data;
    },
    enabled: sha.length >= 7,
  });
}
