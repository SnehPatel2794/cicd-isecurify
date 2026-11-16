// Branding rules: PURE (no I/O, no clock). Colours, logo checks and the derived palette used by the app, PDFs and emails.
export const DEFAULTS = { companyName: 'iSecurify GRC', primaryColor: '#812671', secondaryColor: '#2b2a29', accentColor: '#1b887d', footerText: '' } as const;
export const MAX_LOGO_BYTES = 2 * 1024 * 1024; export const MIN_LOGO_PX = 16; export const MAX_LOGO_PX = 4000;
export const isHex = (s: unknown): s is string => typeof s === 'string' && /^#[0-9a-fA-F]{6}$/.test(s);
export const normHex = (s: string) => s.toLowerCase();
export const rgbOf = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
const toHex = (c: number[]) => '#' + c.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const lin = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
export const luminance = (hex: string) => { const [r, g, b] = rgbOf(hex); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); };
/** WCAG contrast ratio between two colours (1 to 21). */
export const contrast = (a: string, b: string) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
/** Buttons and headings use white text on the primary colour, so it must be dark enough to read (WCAG AA, 4.5:1). */
export const primaryProblem = (hex: string): string | null => contrast(hex, '#ffffff') >= 4.5 ? null : 'The primary colour is too light for white text. Choose a darker colour.';
export const darken = (hex: string, by: number) => toHex(rgbOf(hex).map(v => v * (1 - by))); export const tint = (hex: string, by: number) => toHex(rgbOf(hex).map(v => v + (255 - v) * by));
/** The three shades the screens use: DEFAULT, dark (hover) and light (selected backgrounds). */
export const palette = (primary: string) => ({ DEFAULT: primary, dark: darken(primary, 0.25), light: tint(primary, 0.92) });
export const channels = (hex: string) => rgbOf(hex).join(' ');
/** Text a person typed: control characters removed, spaces collapsed. */
export const cleanText = (s: unknown, max: number) => String(s ?? '').replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

import zlib from 'node:zlib';
export type LogoInfo = { mime: 'image/png' | 'image/jpeg'; width: number; height: number };
/** The PDF library decodes PNGs asynchronously and a damaged one would crash the process, so a PNG is fully checked here first: chunk checksums, header, a complete decompress, the exact size of the pixel data and every row's filter byte. Returns a reason, or null when sound. */
export function pngProblem(buf: Buffer): string | null {
  const bad = 'The PNG file is damaged or uses an unsupported option. Save it again as a standard, non-interlaced PNG.'; let pos = 8; const idat: Buffer[] = []; let ihdr: Buffer | null = null; let ended = false; let first = true;
  while (pos + 12 <= buf.length) { const len = buf.readUInt32BE(pos); const type = buf.toString('latin1', pos + 4, pos + 8); const end = pos + 12 + len; if (len > buf.length || end > buf.length) return bad; const body = buf.subarray(pos + 8, pos + 8 + len);
    if ((zlib.crc32(buf.subarray(pos + 4, pos + 8 + len)) >>> 0) !== buf.readUInt32BE(pos + 8 + len)) return bad; if (first && type !== 'IHDR') return bad; first = false;
    if (type === 'IHDR') { if (len !== 13 || ihdr) return bad; ihdr = body; } else if (type === 'IDAT') idat.push(body); else if (type === 'IEND') { ended = true; break; } pos = end; }
  if (!ihdr || !ended || !idat.length) return bad; const w = ihdr.readUInt32BE(0), h = ihdr.readUInt32BE(4), depth = ihdr[8], ctype = ihdr[9], interlace = ihdr[12]; const channels: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
  if (!channels[ctype] || ![1, 2, 4, 8, 16].includes(depth) || interlace !== 0 || ihdr[10] !== 0 || ihdr[11] !== 0) return bad; const rowBytes = Math.ceil(w * channels[ctype] * depth / 8); const expected = h * (rowBytes + 1); if (expected > 160 * 1024 * 1024) return bad;
  let raw: Buffer; try { raw = zlib.inflateSync(Buffer.concat(idat), { maxOutputLength: expected + 1 }); } catch { return bad; } if (raw.length !== expected) return bad; for (let r = 0; r < h; r++) if (raw[r * (rowBytes + 1)] > 4) return bad; return null;
}
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** Reads the real type and size from the bytes (never from the file name or the sender's media type). Returns a reason in plain words when the file is not acceptable. */
export function inspectLogo(buf: Buffer): { ok: true; info: LogoInfo } | { ok: false; reason: string } {
  if (!buf.length) return { ok: false, reason: 'The file is empty' }; if (buf.length > MAX_LOGO_BYTES) return { ok: false, reason: 'The logo is larger than 2 MB' };
  let info: LogoInfo | null = null;
  if (buf.length >= 24 && buf.subarray(0, 8).equals(PNG) && buf.toString('ascii', 12, 16) === 'IHDR') info = { mime: 'image/png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  else if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) { let i = 2; while (i + 9 < buf.length) { if (buf[i] !== 0xff) { i++; continue; } const m = buf[i + 1]; if (m === 0xff) { i++; continue; } if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) { info = { mime: 'image/jpeg', height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) }; break; } if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; } i += 2 + buf.readUInt16BE(i + 2); } }
  if (!info) return { ok: false, reason: 'The logo must be a PNG or JPG image (SVG and other formats are not accepted)' };
  if (info.width < MIN_LOGO_PX || info.height < MIN_LOGO_PX) return { ok: false, reason: `The logo is too small (at least ${MIN_LOGO_PX} x ${MIN_LOGO_PX} pixels)` };
  if (info.width > MAX_LOGO_PX || info.height > MAX_LOGO_PX) return { ok: false, reason: `The logo is too large (at most ${MAX_LOGO_PX} x ${MAX_LOGO_PX} pixels)` };
  if (info.mime === 'image/png') { const why = pngProblem(buf); if (why) return { ok: false, reason: why }; }
  return { ok: true, info };
}
/** Fit a logo into a box, keeping its proportions. */
export const fitLogo = (w: number, h: number, maxW: number, maxH: number) => { const k = Math.min(maxW / w, maxH / h, 1); return { width: Math.round(w * k), height: Math.round(h * k) }; };
export type Brand = { companyName: string; primaryColor: string; secondaryColor: string; accentColor: string; footerText: string; logo: Buffer | null };
