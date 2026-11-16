// Shared settings for the end-to-end run. Everything is local and throw-away; none of these values are used anywhere else.
export const PORT_API = 4100, PORT_WEB = 5100;
export const DB_NAME = process.env.E2E_DB || 'grc_e2e';
export const ADMIN_URL = process.env.E2E_ADMIN_URL || process.env.TEST_ADMIN_URL || 'mysql://root:root@127.0.0.1:3306/';
export const APP_USER = 'e2e_app', APP_PW = 'e2e_app_pw_0123456789', WORKER_USER = 'e2e_worker', WORKER_PW = 'e2e_worker_pw_0123456789';
export const PASSWORD = 'E2e-Passw0rd!long';
export const USERS = { owner: 'owner@e2e.test', admin: 'casey@acme-e2e.test', vendor: 'vera@acme-e2e.test' };
export const API_ENV = {
  NODE_ENV: 'development', PORT: String(PORT_API), DATABASE_URL: `mysql://${APP_USER}:${APP_PW}@127.0.0.1:3306/${DB_NAME}`,
  APP_ORIGIN: `http://127.0.0.1:${PORT_WEB}`, MFA_ENC_KEY: Buffer.from('e2e-throwaway-key-0123456789abcd').toString('base64'), CSRF_KEY: 'e2e-throwaway-csrf-key-0123456789',
  REQUIRE_MFA_PLATFORM: 'false', EVIDENCE_DIR: './.run/evidence', EVIDENCE_MIN_FREE_MB: '0', EMAIL_DEV_LOG: 'false',
};
