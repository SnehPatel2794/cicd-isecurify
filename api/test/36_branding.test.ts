import { test, before, after } from 'node:test'; import assert from 'node:assert/strict'; import zlib from 'node:zlib';
import { freshEnv, world, mp } from './helpers';
import { isHex, contrast, primaryProblem, palette, darken, tint, inspectLogo, fitLogo, cleanText, DEFAULTS, MAX_LOGO_BYTES } from '../src/modules/branding/rules'; import { renderCertificate } from '../src/modules/certificates/pdf';
const crc = (b: Buffer) => { const o = Buffer.alloc(4); o.writeUInt32BE(zlib.crc32(b) >>> 0); return o; };
const chunk = (t: string, d: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); return Buffer.concat([len, td, crc(td)]); };
/** A real, valid PNG of one solid colour. */
const png = (w: number, h: number, interlace = 0) => { const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[12] = interlace; const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 0x80)]); const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]); };
/** A 1x1 JPEG whose frame header is patched to the size we want (enough for header checks and for embedding). */
const jpeg = (w: number, h: number) => { const b = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64'); const i = b.indexOf(Buffer.from([0xff, 0xc0])); if (i < 0) { const j = b.indexOf(Buffer.from([0xff, 0xc2])); b.writeUInt16BE(h, j + 5); b.writeUInt16BE(w, j + 7); } else { b.writeUInt16BE(h, i + 5); b.writeUInt16BE(w, i + 7); } return b; };
let env: Awaited<ReturnType<typeof freshEnv>>, w: Awaited<ReturnType<typeof world>>, admin: any, team: any, aAdmin: any, aStaff: any;
const rows = async (sql: string, p: any[] = []) => (await env.pool.query(sql, p) as any)[0] as any[]; const upload = (c: any, name: string, buf: Buffer) => { const m = mp(name, buf); return c.call('POST', '/platform/branding/logo', m.payload, m.headers); };
const good = { companyName: 'Acme Assurance', primaryColor: '#1d4ed8', secondaryColor: '#111827', accentColor: '#0f766e', footerText: 'Confidential. Acme Assurance Ltd.' };
before(async () => { env = await freshEnv({ requireMfaForPlatform: false } as any); w = await world(env); admin = await env.login('admin@x.test'); team = await env.login('team@x.test'); aAdmin = await w.as('aAdmin'); aStaff = await w.as('aStaff'); }); after(() => env.close());

test('pure rules: colours, contrast, palette, text cleaning', () => {
  assert.equal(isHex('#812671'), true); assert.equal(isHex('#ABCDEF'), true); for (const bad of ['812671', '#81267', '#8126711', '#gggggg', 'red', '', null, 5]) assert.equal(isHex(bad as any), false);
  assert.ok(contrast('#000000', '#ffffff') > 20.9); assert.equal(Math.round(contrast('#ffffff', '#ffffff')), 1); assert.equal(primaryProblem('#812671'), null); assert.match(primaryProblem('#1b887d')!, /too light/, 'the teal is an accent, too light for white text'); assert.match(primaryProblem('#ffff00')!, /too light/); assert.match(primaryProblem('#ffffff')!, /too light/); assert.equal(primaryProblem('#000000'), null);
  assert.equal(darken('#808080', 0.5), '#404040'); assert.equal(tint('#000000', 1), '#ffffff'); const p = palette('#812671'); assert.equal(p.DEFAULT, '#812671'); assert.ok(contrast(p.dark, '#ffffff') > contrast(p.DEFAULT, '#ffffff')); assert.ok(p.light.startsWith('#f'));
  assert.equal(cleanText('  A\u0000B \n\t C  ', 10), 'A B C'); assert.equal(cleanText('x'.repeat(500), 5), 'xxxxx'); assert.deepEqual(fitLogo(400, 100, 200, 100), { width: 200, height: 50 }); assert.deepEqual(fitLogo(50, 20, 200, 100), { width: 50, height: 20 }); assert.equal(DEFAULTS.primaryColor, '#812671');
});
test('pure rules: logos are judged by their bytes, not their names', () => {
  const ok = inspectLogo(png(120, 40)); assert.ok(ok.ok && ok.info.mime === 'image/png' && ok.info.width === 120 && ok.info.height === 40); const j = inspectLogo(jpeg(200, 80)); assert.ok(j.ok && j.info.mime === 'image/jpeg' && j.info.width === 200 && j.info.height === 80);
  const no = (b: Buffer) => (inspectLogo(b) as any).reason as string; assert.match(no(Buffer.alloc(0)), /empty/); assert.match(no(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), /PNG or JPG/); assert.match(no(Buffer.from('<html><script>alert(1)</script></html>')), /PNG or JPG/); assert.match(no(Buffer.from('GIF89a\u0001\u0000\u0001\u0000')), /PNG or JPG/);
  assert.match(no(png(8, 8)), /too small/); assert.match(no(png(5000, 100)), /too large/); assert.match(no(jpeg(4, 4)), /too small/); assert.match(no(Buffer.concat([png(64, 64), Buffer.alloc(MAX_LOGO_BYTES)])), /2 MB/); assert.match(no(Buffer.from([0x89, 0x50, 0x4e, 0x47])), /PNG or JPG/);
  const good64 = png(64, 64); const flip = Buffer.from(good64); flip[flip.length - 20] ^= 0xff; assert.match(no(flip), /damaged/, 'checksum'); assert.match(no(png(64, 64, 1)), /damaged/, 'interlaced'); assert.match(no(good64.subarray(0, good64.length - 30)), /damaged/, 'truncated');
  const badFilter = (() => { const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(32, 0); ihdr.writeUInt32BE(32, 4); ihdr[8] = 8; ihdr[9] = 2; const raw = Buffer.concat(Array.from({ length: 32 }, () => Buffer.concat([Buffer.from([128]), Buffer.alloc(96)]))); return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]); })(); assert.match(no(badFilter), /damaged/, 'bad filter byte');
  const bomb = (() => { const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(4000, 0); ihdr.writeUInt32BE(4000, 4); ihdr[8] = 8; ihdr[9] = 6; const raw = Buffer.alloc(4000 * (4000 * 4 + 1) + 5000); return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]); })(); assert.match(no(bomb), /damaged/, 'more data than the header allows');
});
test('the public profile and logo need no sign-in, start with the defaults and expose nothing private', async () => {
  const r = await env.client().call('GET', '/branding'); assert.equal(r.status, 200); assert.deepEqual(r.body, { companyName: 'iSecurify GRC', primaryColor: '#812671', secondaryColor: '#2b2a29', accentColor: '#1b887d', footerText: '', hasLogo: false, version: 1 });
  assert.equal((await env.client().call('GET', '/branding/logo')).status, 404); assert.equal(r.headers['x-content-type-options'], 'nosniff');
});
test('only the Super Admin may change branding; everyone else is refused', async () => {
  for (const c of [admin, team, aAdmin, aStaff]) { assert.equal((await c.call('PUT', '/platform/branding', good)).status, 403); assert.equal((await c.call('GET', '/platform/branding')).status, 403); assert.equal((await upload(c, 'logo.png', png(64, 64))).status, 403); assert.equal((await c.call('DELETE', '/platform/branding/logo')).status, 403); }
  const anon = env.client(); assert.equal((await anon.call('PUT', '/platform/branding', good)).status, 401); assert.equal((await w.root.call('PUT', '/platform/branding', good, { 'x-csrf-token': null as any })).status, 403, 'CSRF token is required'); assert.equal((await rows('SELECT version v FROM branding_profile'))[0].v, 1);
});
test('updating: validated, cleaned, versioned and audited; a no-op changes nothing', async () => {
  for (const bad of [{ primaryColor: 'blue' }, { secondaryColor: '#12345' }, { accentColor: '#gggggg' }, { companyName: '   ' }, { companyName: 'x'.repeat(121) }, { footerText: 'x'.repeat(301) }, { primaryColor: '#ffff00' }, { extra: 1, companyName: undefined }]) assert.equal((await w.root.call('PUT', '/platform/branding', { ...good, ...bad })).status, 400, JSON.stringify(bad));
  const r = await w.root.call('PUT', '/platform/branding', { ...good, companyName: '  Acme\u0000  Assurance ', primaryColor: '#1D4ED8' }); assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.companyName, 'Acme Assurance'); assert.equal(r.body.primaryColor, '#1d4ed8'); assert.equal(r.body.version, 2);
  assert.equal((await w.root.call('PUT', '/platform/branding', good)).body.version, 2, 'nothing changed'); const pub = (await env.client().call('GET', '/branding')).body; assert.equal(pub.companyName, 'Acme Assurance'); assert.equal(pub.footerText, good.footerText); assert.ok(!('updatedBy' in pub));
  const ev = await rows("SELECT detail FROM audit_events WHERE action='branding.updated'"); assert.equal(ev.length, 1); assert.ok(JSON.parse(typeof ev[0].detail === 'string' ? ev[0].detail : JSON.stringify(ev[0].detail)).fields.includes('companyName'));
  const full = (await w.root.call('GET', '/platform/branding')).body; assert.equal(full.logo, null); assert.equal(full.defaults.primaryColor, '#812671'); assert.ok(full.updatedBy);
});
test('logo upload: PNG and JPG accepted and served back byte for byte; strict about everything else', async () => {
  const p = png(160, 48); const r = await upload(w.root, 'logo.png', p); assert.equal(r.status, 201, JSON.stringify(r.body)); assert.equal(r.body.width, 160);
  const g = await env.client().call('GET', '/branding/logo'); assert.equal(g.status, 200); assert.equal(g.headers['content-type'], 'image/png'); assert.ok(Buffer.compare(g.raw, p) === 0); assert.equal(g.headers['x-content-type-options'], 'nosniff'); assert.match(String(g.headers['content-security-policy']), /sandbox/); assert.match(String(g.headers['cache-control']), /max-age/);
  const etag = String(g.headers.etag); assert.equal((await env.client().call('GET', '/branding/logo', undefined, { 'if-none-match': etag })).status, 304); assert.equal((await env.client().call('GET', '/branding')).body.hasLogo, true); assert.equal((await env.client().call('GET', '/branding')).body.version, 3);
  const full = (await w.root.call('GET', '/platform/branding')).body; assert.equal(full.logo.mime, 'image/png'); assert.equal(full.logo.size, p.length);
  const j = jpeg(300, 90); assert.equal((await upload(w.root, 'logo.jpg', j)).status, 201); assert.equal((await env.client().call('GET', '/branding/logo')).headers['content-type'], 'image/jpeg');
  const rej = async (name: string, b: Buffer, status: number) => { const x = await upload(w.root, name, b); assert.equal(x.status, status, `${name}: ${JSON.stringify(x.body)}`); }; const before = (await env.client().call('GET', '/branding')).body.version;
  await rej('logo.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>'), 415); await rej('logo.png', Buffer.from('<html><script>alert(1)</script></html>'), 415); await rej('x.png', Buffer.alloc(0), 415); await rej('tiny.png', png(8, 8), 415); await rej('huge.png', png(5000, 5000), 415);
  await rej('big.png', Buffer.concat([png(64, 64), Buffer.alloc(MAX_LOGO_BYTES + 10)]), 413); await rej('i.png', png(64, 64, 1), 415); assert.equal((await env.client().call('GET', '/branding')).body.version, before, 'rejected uploads change nothing');
  assert.equal((await w.root.call('POST', '/platform/branding/logo', { x: 1 })).status, 400); assert.equal((await rows("SELECT COUNT(*) n FROM audit_events WHERE action='branding.logo_set'"))[0].n, 2);
});
test('removing the logo returns to the plain name; removing twice is a 404', async () => {
  assert.equal((await w.root.call('DELETE', '/platform/branding/logo')).status, 200); assert.equal((await env.client().call('GET', '/branding/logo')).status, 404); assert.equal((await env.client().call('GET', '/branding')).body.hasLogo, false); assert.equal((await w.root.call('DELETE', '/platform/branding/logo')).status, 404);
  assert.equal((await rows("SELECT COUNT(*) n FROM audit_events WHERE action='branding.logo_removed'"))[0].n, 1);
});
test('certificates carry the logo, colour and name; a broken logo never blocks a document', async () => {
  const doc = { number: 'C-1', organizationName: 'Org A', frameworkName: 'Fx', frameworkVersion: 1, scope: 'All systems', issuedOn: '2026-10-27', validUntil: '2027-10-27', verifyUrl: 'https://x.test/verify/abc', issuedBy: 'Dana', engagementName: 'Audit' };
  const count = (b: Buffer) => (b.toString('latin1').match(/\/Subtype \/Image/g) ?? []).length; const plain = await renderCertificate(doc); const brand = { ...DEFAULTS, companyName: 'Acme Assurance', primaryColor: '#1d4ed8' };
  const withLogo = await renderCertificate(doc, { ...brand, logo: png(160, 48) }); assert.equal(withLogo.subarray(0, 4).toString(), '%PDF'); assert.ok(count(withLogo) > count(plain)); assert.ok(withLogo.toString('latin1').includes('(Acme Assurance)'), 'author is the company'); assert.ok(plain.toString('latin1').includes('(iSecurify GRC)'));
  const broken = await renderCertificate(doc, { ...brand, logo: Buffer.from('not an image') }); assert.equal(broken.subarray(0, 4).toString(), '%PDF'); assert.equal(count(broken), count(plain));
});
test('database: the profile cannot be deleted, duplicated or given bad values, even with raw SQL', async () => {
  const rej = (sql: string, re: RegExp, p: any[] = []) => assert.rejects(env.pool.query(sql, p), re);
  await rej('DELETE FROM branding_profile', /cannot be deleted/); await rej("INSERT INTO branding_profile(id,company_name,primary_color,secondary_color,accent_color) VALUES (2,'x','#000000','#000000','#000000')", /chk_branding_one|constraint/i); await rej("UPDATE branding_profile SET primary_color='red'", /chk_branding_colors|constraint/i);
  await rej("UPDATE branding_profile SET company_name='  '", /chk_branding_name|constraint/i); await rej("UPDATE branding_profile SET logo_mime='image/png'", /chk_branding_logo|constraint/i);
});
