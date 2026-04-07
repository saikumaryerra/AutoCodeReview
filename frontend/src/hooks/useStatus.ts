import { useQuery } from '@tanstack/react-query';
import { statusApi } from '../api/client';

export function useStatus() {
  return useQuery({
    queryKey: ['status'],
    queryFn: async () => {
      const res = await statusApi.get();
      return res.data.data;
    },
    refetchInterval: 10000,
  });
}
