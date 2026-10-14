import { z } from 'zod';

/** Version of the AI privacy notice (FR-015). Bump it when the notice text changes. */
export const AI_CONSENT_VERSION = '2026-10';

export const AiConsentBody = z.object({ version: z.literal(AI_CONSENT_VERSION) });
export type AiConsentBody = z.input<typeof AiConsentBody>;

export const AiConsent = z.object({
  version: z.string(),
  acceptedAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
});
export type AiConsent = z.infer<typeof AiConsent>;

/** Active consent: accepted, not revoked, for the current notice version. */
export const hasActiveConsent = (c: { version?: string; acceptedAt?: unknown; revokedAt?: unknown } | null | undefined) =>
  !!c && c.version === AI_CONSENT_VERSION && !!c.acceptedAt && !c.revokedAt;
