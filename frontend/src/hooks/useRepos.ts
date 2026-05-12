import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { reposApi } from '../api/client';
import type { AddRepoBody, UpdateRepoBody } from '../types';

export function useRepos() {
  return useQuery({
    queryKey: ['repos'],
    queryFn: async () => {
      const res = await reposApi.list();
      return res.data.data;
    },
  });
}

export function useAddRepo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: AddRepoBody) => reposApi.add(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repos'] });
    },
  });
}

export function useUpdateRepo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateRepoBody }) =>
      reposApi.update(id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repos'] });
    },
  });
}

export function useDeleteRepo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => reposApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repos'] });
    },
  });
}

export function useRepoStandards(id: string) {
  return useQuery({
    queryKey: ['repos', id, 'coding-standards'],
    queryFn: async () => {
      const res = await reposApi.getStandards(id);
      return res.data.data;
    },
    enabled: !!id,
  });
}

export function useUpdateRepoStandards() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, coding_standards }: { id: string; coding_standards: string }) =>
      reposApi.updateStandards(id, coding_standards),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['repos', variables.id, 'coding-standards'] });
      queryClient.invalidateQueries({ queryKey: ['repos'] });
    },
  });
}

export function useRegenerateRepoStandards() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => reposApi.regenerateStandards(id),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ['repos', id, 'coding-standards'] });
      queryClient.invalidateQueries({ queryKey: ['repos'] });
    },
  });
}
