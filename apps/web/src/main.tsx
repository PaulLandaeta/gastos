import './zodConfig';
import { IconContext } from '@phosphor-icons/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { queryClient } from './app/queryClient';
import { prefetchRoutes, router } from './app/router';
import { AuthProvider } from './features/auth/AuthProvider';
import { UpdatePrompt } from './features/pwa/UpdatePrompt';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Icons are decorative by default: every control keeps its own text or aria-label. */}
    <IconContext.Provider value={{ size: 20, weight: 'regular', 'aria-hidden': true }}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          {/* Registers the service worker on every page (login included) and announces updates. */}
          <UpdatePrompt />
          <RouterProvider router={router} />
        </AuthProvider>
      </QueryClientProvider>
    </IconContext.Provider>
  </StrictMode>,
);

// After the first paint, fetch the remaining screens while the browser is idle (fast start, works offline).
window.addEventListener('load', () => {
  const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 200));
  idle(() => prefetchRoutes());
});
