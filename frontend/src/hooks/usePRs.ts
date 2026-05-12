import { useQuery } from '@tanstack/react-query';
import { prsApi } from '../api/client';
import type { PRListParams } from '../types';

export function usePRs(params: PRListParams = {}) {
  return useQuery({
    queryKey: ['prs', params],
    queryFn: async () => {
      const res = await prsApi.list(params);
      return res.data;
    },
  });
}
