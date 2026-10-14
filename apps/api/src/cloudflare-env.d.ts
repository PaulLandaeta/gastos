import type { Env as AppBindings } from './env.js';

declare global {
  namespace Cloudflare {
    // Bindings exposed by `cloudflare:workers` in tests and runtime.
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface Env extends AppBindings {}
  }
}

export {};
