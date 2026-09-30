# What was fixed

## 🔴 Security — rotate your SMTP key now
`backend/app/services/email.py` had a **live Brevo SMTP password hardcoded in
source** and committed to your public GitHub repo. Anyone can read your repo
history and use it to send email as you.
- **Do this now:** log into Brevo → SMTP & API keys → revoke/regenerate that key.
- Fixed: `email.py` now reads `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
  `SMTP_PASSWORD`, `EMAIL_FROM` from environment variables (these already
  existed in `app/core/config.py` but were never actually used — the code
  was silently sending through a different hardcoded account instead).
- Set these in your `.env` / hosting provider's env vars:
  ```
  SMTP_HOST=smtp-relay.brevo.com
  SMTP_PORT=587
  SMTP_USER=your_new_brevo_login
  SMTP_PASSWORD=your_new_brevo_key
  EMAIL_FROM=your_from_address
  ```

## 🐢 The "lag on every process" bug
Every write action — submitting an outpass, approving/rejecting it, and
scanning a student at the gate — was `await`-ing 1–3 **live SMTP email
sends in sequence**, and gate scans additionally rewrote an Excel file with
pandas/openpyxl, **all before the API responded**. So every button click in
the app waited on real email round-trips (often 1-5+ seconds each, and
stacked when 2-3 emails were sent per action) plus disk I/O.

Fixed in `app/routes/outpass.py`, `app/services/excel.py`, and
`app/services/email.py`:
- `apply`, `approve`, `reject`, and `mark-gate` now use FastAPI's
  `BackgroundTasks` — the response is returned to the browser immediately,
  and emails/Excel regeneration happen right after, off the request path.
- The Excel write itself now runs via `asyncio.to_thread`, so even in the
  background it can't block the event loop and stall *other* users'
  requests while a report is being written.
- SMTP sends now have a bounded 15s timeout so a slow/unreachable mail
  server can never hang a background task forever.

Net effect: apply / approve / reject / gate-scan should now feel close to
instant, since the frontend no longer waits on SMTP or file I/O at all.

## No other request changes
Routes' inputs/outputs, response models, and business logic (approval
sequencing, RBAC, QR token generation) are untouched — only *when* the
side-effects (email, Excel) run has changed.

## What I did not change
- I didn't touch the frontend polling intervals (15s) or dashboard code —
  after reviewing all four dashboards, I didn't find frontend-side bugs
  causing the lag; the slowness traced back entirely to the backend
  blocking on SMTP/file I/O described above. If you're still seeing lag
  after deploying this, tell me specifically which screen/action feels slow
  and I'll dig further.
