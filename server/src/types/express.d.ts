import type { AuthContext } from '../auth/types.js';

/**
 * Express request augmentation.
 *
 * - `id` is assigned by the requestId middleware, so it is always present once
 *   that middleware has run.
 * - `auth` is set only by `requireAuth`; its absence is meaningful (an
 *   unauthenticated request), which is why it is optional rather than asserted.
 */
declare global {
  namespace Express {
    interface Request {
      id: string;
      auth?: AuthContext;
    }
  }
}

export {};
