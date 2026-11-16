// Pure helpers for branding on the screens. They mirror the server rules (api/src/modules/branding/rules.ts) so the preview and the checks match.
export const DEFAULTS = { companyName: 'iSecurify GRC', primaryColor: '#812671', secondaryColor: '#2b2a29', accentColor: '#1b887d', footerText: '' };
export type Profile = typeof DEFAULTS & { hasLogo?: boolean; version?: number };
export const isHex = (s: unknown): s is string => typeof s === 'string' && /^#[0-9a-fA-F]{6}$/.test(s);
export const rgbOf = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
const lin = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
const lum = (hex: string) => { const [r, g, b] = rgbOf(hex); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); };
export const contrast = (a: string, b: string) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
export const primaryProblem = (hex: string) => !isHex(hex) ? 'Use a colour like #812671' : contrast(hex, '#ffffff') >= 4.5 ? null : 'Too light for white text. Choose a darker colour.';
const mix = (hex: string, f: (v: number) => number) => rgbOf(hex).map(v => Math.max(0, Math.min(255, Math.round(f(v))))).join(' ');
/** The CSS variables for a primary colour: DEFAULT, dark (hover) and light (selected backgrounds), as space-separated channels. */
export const brandVars = (primary: string): Record<string, string> => { const p = isHex(primary) ? primary : DEFAULTS.primaryColor; return { '--brand': rgbOf(p).join(' '), '--brand-dark': mix(p, v => v * 0.75), '--brand-light': mix(p, v => v + (255 - v) * 0.92) }; };
export const LOGO_TYPES = ['image/png', 'image/jpeg']; export const MAX_LOGO = 2 * 1024 * 1024;
/** Checked in the browser before uploading so people are not sent through avoidable errors (the server checks again). */
export const logoProblem = (f: { type: string; size: number }) => !LOGO_TYPES.includes(f.type) ? 'The logo must be a PNG or JPG image' : f.size > MAX_LOGO ? 'The logo is larger than 2 MB' : f.size === 0 ? 'The file is empty' : null;
export const logoUrl = (version?: number) => `/api/branding/logo?v=${version ?? 0}`;
export const sameProfile = (a: Profile, b: Profile) => (['companyName', 'primaryColor', 'secondaryColor', 'accentColor', 'footerText'] as const).every(k => a[k] === b[k]);
