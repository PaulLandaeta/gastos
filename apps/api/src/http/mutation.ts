import type { MutationContext } from '../services/tripRepo.js';
import type { AppContext } from './context.js';

export function mutationContext(c: AppContext): MutationContext {
  return { actorUid: c.get('user').uid, correlationId: c.get('correlationId'), now: new Date() };
}
