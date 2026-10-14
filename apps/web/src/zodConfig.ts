import { z } from 'zod';

/**
 * Feature 006 (FR-026): no `new Function` under the strict CSP. Without this, Zod probes eval once
 * and the browser reports a (harmless) CSP violation; validation stays identical.
 */
z.config({ jitless: true });
