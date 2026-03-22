# Methna QA Automation Test System

Complete Python-based load testing and API integration test suite for the Methna backend.

## Quick Start

```bash
cd tests
pip install -r requirements.txt

# Smoke test (3 users, fast)
python run_tests.py --smoke

# Medium test (10 users, 5 concurrent)
python run_tests.py --users 10 --concurrency 5

# Full load test (200 users, 10 concurrent)
python run_tests.py

# Custom
python run_tests.py --users 50 --concurrency 20 --timeout 45
```

## Architecture

```
tests/
├── run_tests.py      # Main entry point + CLI dashboard
├── config.py         # All endpoints, timeouts, test params
├── fake_user.py      # Realistic Muslim-themed fake data generator
├── api_client.py     # Async HTTP client wrapping all API calls
├── user_flow.py      # Full user journey simulation with retries
├── load_test.py      # Concurrent orchestrator with semaphore
├── reporter.py       # Summary, error, and JSON report generation
├── requirements.txt  # Python dependencies
└── test_reports/     # Generated reports (after running)
    ├── methna_test.log
    ├── summary_report.txt
    ├── error_report.txt
    └── results.json
```

## What Each Simulated User Does

1. **Register** — POST `/auth/register` with unique fake data
2. **Verify OTP** — POST `/auth/verify-otp` (tries common test codes)
3. **Login fallback** — If OTP fails, tries `/auth/login`
4. **Get profile** — GET `/users/me`
5. **Update profile** — PATCH `/profiles` with gender, bio, interests, etc.
6. **Set location** — PATCH `/profiles/location`
7. **Navigate screens** — Hits 18 authenticated endpoints (matches, chat, notifications, monetization, etc.)
8. **Random actions** — Search, nearby, recommendations, token refresh
9. **Logout** — POST `/auth/logout`

## Reports

After a run, check `test_reports/`:

- **summary_report.txt** — Success rates, latency percentiles, per-endpoint breakdown
- **error_report.txt** — Every failed user with step-by-step error details
- **results.json** — Machine-readable full results
- **methna_test.log** — Verbose debug log of every HTTP request

## Bug Detection

The system automatically detects and diagnoses:
- Timeout clusters (server overload)
- Connection errors (backend down)
- OTP delivery failures (SMTP misconfigured)
- Auth token issues (401/403 on protected routes)
- Slow endpoints (>5s average)
- High failure rates per endpoint

## Configuration

Edit `config.py` to change:
- `BASE_URL` — Backend API URL
- `TOTAL_USERS` — Default user count (200)
- `CONCURRENCY` — Default parallel sessions (10)
- `REQUEST_TIMEOUT` — Per-request timeout (30s)
- `MAX_RETRIES` — Retry failed flows (2)
- `PASSWORD` — Shared test password
