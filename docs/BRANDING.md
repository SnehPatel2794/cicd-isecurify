# Branding (Phase 10B)

One branding profile for the whole platform, managed by the **super admin** at *Administration → Branding*.

| Setting | Default | Notes |
|---|---|---|
| Company name | iSecurify GRC | Screens, page title, PDFs, certificates, emails |
| Primary colour | #812671 | Buttons, links, PDF accents. Must give at least 4.5:1 contrast with white text (the screen and the server both check) |
| Secondary colour | #2b2a29 | Dark text and headings |
| Accent colour | #1b887d | Highlights. Too light to be a primary colour |
| Footer text | empty | Added to PDFs and emails |
| Logo | none | PNG or JPG, up to 2 MB, 16–4000 px. Without a logo the name is shown |

## Where it applies
- Screens: colours are CSS variables set at start-up; the sign-in page is branded too (the profile is public).
- Reports and certificates: read on each download, so a change shows the next time a document is produced.
- Emails: the worker reads the profile when it renders each message.
- Documents never fail because of branding: an unreadable logo or profile falls back to the defaults.

## API
- `GET /api/branding` and `GET /api/branding/logo` are public (logo is cached by its fingerprint).
- `GET/PUT /api/platform/branding`, `POST/DELETE /api/platform/branding/logo` are super admin only, audited (`branding.updated`, `branding.logo_set`, `branding.logo_removed`).

## Logo safety
PNG files are fully validated (chunk checksums, size, no interlacing, bounded decompression) because the PDF library would otherwise crash on a damaged file. The logo is served with a locked-down content policy.
