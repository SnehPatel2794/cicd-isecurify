import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import type { Pool } from '../db'; import type { Config } from '../config'; import type { RateLimiter } from './ratelimit';
export type SessionUser = { id: string; email: string; name: string; platformRole: string; mfaEnabled: boolean };
export type Ctx = {
  pool: Pool; cfg: Config; limiter: RateLimiter;
  withSession: (o?: { allowPending?: boolean; allowUnenrolled?: boolean }) => (req: FastifyRequest) => Promise<void>;
  U: (req: any) => SessionUser;
  parse: <T extends z.ZodTypeAny>(s: T, d: unknown) => z.infer<T>;
};
export const isAdminLevel = (u: { platformRole: string }) => u.platformRole === 'super_admin' || u.platformRole === 'admin';
