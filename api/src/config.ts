import { z } from 'zod';
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  PURGE_DATABASE_URL: z.string().optional(),   // optional: the account used only to wipe a demo organization (docs/DEMO_DATA.md). Unset = the wipe button reports that it is not set up
  APP_ORIGIN: z.string().url().optional(),
  WEBHOOK_ENC_KEY: z.string().optional(),   // base64 of 32 random bytes; seals webhook signing secrets. Shared by the API and the worker (NOT the MFA key). Unset = webhooks are switched off
  WEBHOOK_ALLOW_HTTP: z.string().default('false'),   // development only: allow http:// and private addresses
  MFA_ENC_KEY: z.string().min(1),          // base64 of 32 random bytes
  CSRF_KEY: z.string().min(16),
  EMAIL_DEV_LOG: z.string().optional(),
  REQUIRE_MFA_PLATFORM: z.string().default('true'),
  EVIDENCE_DIR: z.string().default('./data/evidence'),            // a Docker volume shared by api and worker
  EVIDENCE_MAX_FILE_MB: z.coerce.number().int().min(1).max(100).default(25),
  EVIDENCE_DEFAULT_QUOTA_MB: z.coerce.number().int().min(0).default(0),   // per organization; 0 = unlimited (the default). Admins can still set a limit for one organization
  EVIDENCE_MIN_FREE_MB: z.coerce.number().int().min(0).default(1024),   // uploads pause when the evidence disk has less than this free; 0 turns the guard off
  EVIDENCE_AUTO_SCAN: z.string().default('false'),                 // scan every upload automatically when ClamAV is configured
  EVIDENCE_LINK_HOSTS: z.string().default(''),                     // optional allow-list for evidence links, e.g. "drive.google.com,docs.google.com"
  CLAMAV_HOST: z.string().optional(),
  SMTP_HOST: z.string().optional(), SMTP_PORT: z.string().optional(), SMTP_TLS: z.string().optional(), MAIL_FROM: z.string().optional(),   // outgoing email is sent by the WORKER; the API only reports whether it is configured
});
export type EvidenceConfig = { dir: string; maxFileBytes: number; defaultQuotaBytes: number | null; minFreeBytes: number; scannerEnabled: boolean; autoScan: boolean; linkHosts: string[]; maxVersionsPerRequest: number; maxRequestsPerItem: number; uploadsPerHour: number; scansPerHour: number };
export const evidenceDefaults = (dir: string): EvidenceConfig => ({ dir, maxFileBytes: 25 * 1048576, defaultQuotaBytes: null, minFreeBytes: 0, scannerEnabled: false, autoScan: false, linkHosts: [], maxVersionsPerRequest: 50, maxRequestsPerItem: 20, uploadsPerHour: 120, scansPerHour: 60 });
export type Config = {
  production: boolean; origin?: string; mfaKey: Buffer; csrfKey: string; requireMfaForPlatform: boolean;
  limits: { login: number; reset: number; mfa: number }; logStream?: any; logLevel: string;
  webhookKey?: Buffer; allowHttpWebhooks?: boolean;
  mail?: { configured: boolean; host?: string; port?: number; tls?: string; from?: string };
  purgeDatabaseUrl?: string; purgePool?: any;   // the demo-wipe account (a pool is created lazily by the server; tests pass their own)
  evidence?: Partial<EvidenceConfig>;       // optional so older callers keep working; missing fields take evidenceDefaults
};
/** Things that must never be true of a production configuration. Returns plain-language problems; empty means safe. PURE. */
export function productionProblems(c: { origin?: string; csrfKey: string; mfaKey: Buffer; requireMfaForPlatform: boolean; databaseUrl: string }): string[] {
  const out: string[] = [];
  if (!c.origin || !/^https:\/\/[^/\s]+$/.test(c.origin)) out.push('APP_ORIGIN must be the public https address of the site (no path), for example https://grc.example.com');
  if (c.csrfKey.length < 32) out.push('CSRF_KEY must be at least 32 characters (openssl rand -base64 48)'); if (/^(.)\1+$/.test(c.csrfKey) || /change.?me|example|password|secret|test-csrf/i.test(c.csrfKey)) out.push('CSRF_KEY looks like a placeholder: generate a random one');
  if (c.mfaKey.every(b => b === c.mfaKey[0])) out.push('MFA_ENC_KEY looks like a placeholder (all bytes equal): generate a random one');
  if (!c.requireMfaForPlatform) out.push('REQUIRE_MFA_PLATFORM=false is not allowed in production');
  try { const u = new URL(c.databaseUrl); if (decodeURIComponent(u.username) === 'root') out.push('The application must connect with its own least-privilege database account, not root'); } catch { out.push('DATABASE_URL is not a valid URL'); }
  return out;
}
export function loadConfig(env = process.env): Config & { databaseUrl: string; port: number } {
  const e = schema.parse(env);
  const mfaKey = Buffer.from(e.MFA_ENC_KEY, 'base64');
  if (mfaKey.length !== 32) throw new Error('MFA_ENC_KEY must be base64 of exactly 32 bytes');
  const webhookKey = e.WEBHOOK_ENC_KEY ? Buffer.from(e.WEBHOOK_ENC_KEY, 'base64') : undefined; if (webhookKey && webhookKey.length !== 32) throw new Error('WEBHOOK_ENC_KEY must be base64 of exactly 32 bytes');
  const cfg = { webhookKey, allowHttpWebhooks: e.WEBHOOK_ALLOW_HTTP === 'true' && e.NODE_ENV !== 'production', production: e.NODE_ENV === 'production', origin: e.APP_ORIGIN, mfaKey, csrfKey: e.CSRF_KEY,
    requireMfaForPlatform: e.REQUIRE_MFA_PLATFORM !== 'false', limits: { login: 20, reset: 5, mfa: 10 }, logLevel: 'info',
    databaseUrl: e.DATABASE_URL, purgeDatabaseUrl: e.PURGE_DATABASE_URL || undefined, port: e.PORT, mail: e.SMTP_HOST ? { configured: !!e.MAIL_FROM, host: e.SMTP_HOST, port: Number(e.SMTP_PORT ?? ((e.SMTP_TLS ?? 'starttls') === 'tls' ? 465 : 587)), tls: e.SMTP_TLS ?? 'starttls', from: e.MAIL_FROM } : { configured: false },
    evidence: { dir: e.EVIDENCE_DIR, maxFileBytes: e.EVIDENCE_MAX_FILE_MB * 1048576, defaultQuotaBytes: e.EVIDENCE_DEFAULT_QUOTA_MB > 0 ? e.EVIDENCE_DEFAULT_QUOTA_MB * 1048576 : null, minFreeBytes: e.EVIDENCE_MIN_FREE_MB * 1048576, scannerEnabled: !!e.CLAMAV_HOST, autoScan: e.EVIDENCE_AUTO_SCAN === 'true' && !!e.CLAMAV_HOST,
      linkHosts: e.EVIDENCE_LINK_HOSTS.split(',').map(h => h.trim().toLowerCase()).filter(Boolean) } };
  if (cfg.production) { const problems = productionProblems(cfg); if (problems.length) throw new Error('Unsafe production configuration:\n - ' + problems.join('\n - ')); }
  return cfg;
}
