import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { reposApi } from '../api/client';

export function useRepoSettings(id: string) {
  return useQuery({
    queryKey: ['repos', id, 'settings'],
    queryFn: async () => {
      const res = await reposApi.getSettings(id);
      return res.data.data;
    },
    enabled: !!id,
  });
}

export function useSetRepoSetting() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, key, value }: { id: string; key: string; value: unknown }) =>
      reposApi.setSetting(id, key, value),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['repos', variables.id, 'settings'] });
    },
  });
}

export function useResetRepoSetting() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, key }: { id: string; key: string }) => reposApi.resetSetting(id, key),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['repos', variables.id, 'settings'] });
    },
  });
}

export function useResetAllRepoSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => reposApi.resetAllSettings(id),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ['repos', id, 'settings'] });
    },
  });
}
