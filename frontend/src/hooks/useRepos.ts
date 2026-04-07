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
