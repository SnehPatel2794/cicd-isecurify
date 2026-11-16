# Threat model and the tests that back it (Phase 10I)

Each row is a way an attacker, or a careless user, could try to get at another organization's data or gain power they were not given, and the automated test that tries it. A test that passes means the attack was attempted and failed; it does not prove there is no other attack.

| Threat | What the test does | Test file |
|---|---|---|
| SQL injection through filters, search text, ids, login fields | Sends injection payloads to **every** GET route in every query parameter the route's schema names, signed out and as client admin, vendor, iSecurify staff and platform admin; also into path parameters on every method. Free-text filters are compared with a nonsense string so a payload that changes the result is caught. A static check refuses any code that puts request input into SQL text. | `api/test/45_injection_probes.test.ts` |
| Mass assignment (adding fields you were not offered) | Valid requests plus privileged extras (role, platform role, tenant, ids, status, creator, closed date, evidence outcome, foreign users) on invitations, engagements, checklist items, risks, incidents, policies, vendors, findings, membership; then reads the database to prove nothing was set. A sweep sends privileged extras to **every** write route as four different callers and checks nothing was created in another organization and no platform role changed. | `api/test/46_mass_assignment.test.ts` |
| Session fixation | A cookie chosen by an attacker is never adopted; every login issues a fresh secret. | `47_session_threats` |
| Session theft and replay | Secret stored only as a hash; never in a response; cookie flags (HttpOnly, SameSite=Strict, Secure and `__Host-` in production); session dies on logout, revoke, password change, account disabled and expiry; a session waiting for the second factor reaches nothing. | `47_session_threats` |
| Cross-site forgery | A request with the cookie but without the matching token is refused, including tokens from another session or another user; foreign Origin and form posts are refused. | `47_session_threats` |
| Export leaks | Every export holds only the caller's organization; other organizations and roles are refused; spreadsheet formulas are neutralised; downloads are never cached or sniffed; file routes refuse anonymous callers and other organizations; errors do not echo SQL or stack traces. | `api/test/48_export_leaks.test.ts` |
| The browser journey itself | Real browser, real API and database; also checks a vendor sees only their own work and a customer admin cannot review their own evidence. | `e2e/journey.spec.ts` |
| Known-vulnerable packages, images, committed secrets | `npm audit`, CodeQL (existing); Trivy on the three images and gitleaks on the full history (new, `security-scan.yml`). | CI |

## Accepted limits (stated, not hidden)

- Whoever holds a user's **complete** session cookie can read `/auth/me`, learn the CSRF token and act as that user until the session ends. That is normal for cookie sessions. HttpOnly and SameSite make theft hard, users can see and revoke sessions, and a password change ends all others. A test records this limit.
- The injection probes prove the tested payloads cause no database error, no leak and no changed result. They are not a substitute for a professional penetration test before go-live.
- Container and secret scanning run in GitHub; they have not been run by the author.
