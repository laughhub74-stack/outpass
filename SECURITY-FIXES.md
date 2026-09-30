# Review fixes applied

## Done in code
| # | Issue | Fix |
|---|-------|-----|
| 1 | Vercel can't run scheduler / write reports | Removed `vercel.json`; added `render.yaml` + `backend/Procfile` (single long-lived instance). Deploy on Render/Railway/VM. |
| 2 | Student data in repo | Deleted `backend/reports/`; `.gitignore` now blocks `backend/reports/`, `*.xlsx`, `.env*`. |
| 4 | Default admin login in `seed_db.py` | No defaults: script exits unless `SUPER_ADMIN_*` are set and password is not weak. |
| 5 | No `.env.example` | Added `backend/.env.example` and `fixed-frontend/.env.example`. |
| - | `in_date` / `out_date` rules | `in_date` must be after `out_date`, `out_date` not in the past, max 30 days (also enforced on admin edits). |
| - | Gate scan ignored time window | EXIT rejected before `out_date - GATE_EXIT_EARLY_GRACE_MINUTES` and after `in_date`. ENTRY always allowed so late returns can be recorded. |
| - | Login hardening | Per-IP and per-email throttle (5 fails → 15 min lock, 429 + `Retry-After`); non-text JSON returns 400 not 500; `/login` and `/login-json` share one code path. |
| - | Password rules | Minimum 8 (max 128) on create, change-password and admin update (frontend hint updated). |
| - | Fake recipients | `hod@college.edu` / `warden@college.edu` / `student@college.edu` fallbacks removed; missing recipients are logged and skipped. |
| - | Reminder went to any warden | New `find_warden_for_hostel`; used by reminder job and next-approver notification. |
| - | Biometric key tied to `SECRET_KEY` | Optional `BIOMETRIC_ENCRYPTION_KEY`; legacy key kept as decrypt-only fallback; `decrypt_biometric_payload` added. |
| - | Tests broken | `pytest.ini` (`asyncio_mode=auto`), `conftest.py`, proper async fixture, integration tests skip if Mongo is unreachable, new DB-free `tests/test_unit.py`. |
| - | Dependencies | `requirements.txt` uses `~=` pins; dropped `python-jose` (and its `ecdsa` advisory) for `PyJWT`; removed unused `passlib`. |
| - | Session lifetime | Default token life 24h → 8h (`ACCESS_TOKEN_EXPIRE_MINUTES`). |

## You still have to do (cannot be fixed by code)
1. **Make the GitHub repo private**, and purge history: the old `backend/reports/*.xlsx` files are still in git history. Recreate the repo from this folder (fresh `git init`) or use `git filter-repo --path backend/reports --invert-paths` and force-push.
2. **Confirm the old Brevo SMTP key is revoked** in Brevo, and set a new `SMTP_PASSWORD`.
3. If `seed_db.py` ever ran with the old defaults, **change or delete `arthur@admin.com`**.
4. Set env vars on the host (see `backend/.env.example`). Generate a fresh `SECRET_KEY`.
5. **Biometrics:** the fingerprint is stored but not verified at the gate (needs a Mantra RD match flow). Get consent and define retention/deletion under India's DPDP Act before storing it. Set `BIOMETRIC_ENCRYPTION_KEY`.
6. After `pip install -r requirements.txt` and a passing `pytest`, run `pip freeze > requirements.lock` for exact reproducibility.
7. Login throttling is in-memory (fine for one instance). JWT is still in `localStorage`; moving to httpOnly cookies needs a frontend change.
8. Generated reports live on local disk; on hosts with ephemeral disks they vanish on redeploy (they are regenerated on demand).
