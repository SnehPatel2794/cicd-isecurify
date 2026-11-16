// Security headers for every API response (defence in depth: Caddy sets them too, but the API must be safe if reached some other way). PURE.
export function securityHeaders(production: boolean): Record<string, string> {
  const h: Record<string, string> = {
    'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin', 'Cross-Origin-Resource-Policy': 'same-origin', 'Cross-Origin-Opener-Policy': 'same-origin', 'X-Permitted-Cross-Domain-Policies': 'none',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    // The API only returns JSON and downloads: it never needs to load anything, be framed, or submit forms.
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  };
  if (production) h['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  return h;
}
/** Keep a caller's request id for log correlation only if it is short and plain; otherwise make a new one (a header must never carry log-injection text). */
export const requestIdFrom = (inbound: unknown, gen: () => string): string => typeof inbound === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(inbound) ? inbound : gen();
