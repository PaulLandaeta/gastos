import { QueryClient, onlineManager } from '@tanstack/react-query';
import { isOnline, subscribeOnline } from '../lib/useOnline';
import { ApiError } from '../lib/apiClient';

/**
 * Feature 005: TanStack Query follows the app's connection state (browser + API failures) and
 * starts from the real state, so an offline start shows cached data instead of failing requests.
 */
onlineManager.setEventListener((setOnline) => {
  setOnline(isOnline());
  return subscribeOnline(() => setOnline(isOnline()));
});

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
    },
    mutations: { retry: false },
  },
});
