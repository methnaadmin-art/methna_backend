"""
Methna QA Test System — Configuration
All API endpoints, timeouts, and test parameters.
"""

# ─── Backend Base URL ─────────────────────────────────────────────────────────
BASE_URL = "https://jordan-backend-production.up.railway.app/api/v1"

# ─── Auth Endpoints (Public) ─────────────────────────────────────────────────
AUTH_REGISTER       = f"{BASE_URL}/auth/register"
AUTH_VERIFY_OTP     = f"{BASE_URL}/auth/verify-otp"
AUTH_RESEND_OTP     = f"{BASE_URL}/auth/resend-otp"
AUTH_LOGIN          = f"{BASE_URL}/auth/login"
AUTH_REFRESH        = f"{BASE_URL}/auth/refresh"
AUTH_LOGOUT         = f"{BASE_URL}/auth/logout"
AUTH_FORGOT_PASS    = f"{BASE_URL}/auth/forgot-password"
AUTH_TEST_OTP       = f"{BASE_URL}/auth/test-otp"

# ─── User / Profile Endpoints (Authenticated) ────────────────────────────────
USERS_ME            = f"{BASE_URL}/users/me"
PROFILE_ME          = f"{BASE_URL}/profiles/me"
PROFILE_CREATE      = f"{BASE_URL}/profiles"
PROFILE_LOCATION    = f"{BASE_URL}/profiles/location"
PROFILE_PREFERENCES = f"{BASE_URL}/profiles/preferences"

# ─── Discovery / Matching ────────────────────────────────────────────────────
MATCHES_LIST        = f"{BASE_URL}/matches"
MATCHES_SUGGESTIONS = f"{BASE_URL}/matches/suggestions"
MATCHES_DISCOVER    = f"{BASE_URL}/matches/discover"
MATCHES_NEARBY      = f"{BASE_URL}/matches/nearby"
SMART_SUGGESTIONS   = f"{BASE_URL}/matching/smart-suggestions"
RECOMMENDED         = f"{BASE_URL}/matching/recommended"

# ─── Swipes ──────────────────────────────────────────────────────────────────
SWIPE               = f"{BASE_URL}/swipes"
WHO_LIKED_ME        = f"{BASE_URL}/swipes/who-liked-me"

# ─── Photos ──────────────────────────────────────────────────────────────────
PHOTOS_UPLOAD       = f"{BASE_URL}/photos/upload"
PHOTOS_ME           = f"{BASE_URL}/photos/me"

# ─── Notifications ───────────────────────────────────────────────────────────
NOTIFICATIONS       = f"{BASE_URL}/notifications"
NOTIF_UNREAD        = f"{BASE_URL}/notifications/unread-count"
NOTIF_SETTINGS      = f"{BASE_URL}/notifications/settings"

# ─── Chat ────────────────────────────────────────────────────────────────────
CONVERSATIONS       = f"{BASE_URL}/chat/conversations"
CHAT_UNREAD         = f"{BASE_URL}/chat/unread"

# ─── Monetization ────────────────────────────────────────────────────────────
MONETIZATION_STATUS = f"{BASE_URL}/monetization/status"
MONETIZATION_LIMITS = f"{BASE_URL}/monetization/limits"

# ─── Reports & Blocking ─────────────────────────────────────────────────────
BLOCKED_USERS       = f"{BASE_URL}/reports/blocked"

# ─── Subscriptions ──────────────────────────────────────────────────────────
SUBSCRIPTION_ME     = f"{BASE_URL}/subscriptions/me"
SUBSCRIPTION_PLANS  = f"{BASE_URL}/subscriptions/plans"

# ─── Analytics ───────────────────────────────────────────────────────────────
ANALYTICS_PROFILE   = f"{BASE_URL}/analytics/profile"

# ─── Profile Views ──────────────────────────────────────────────────────────
PROFILE_VIEWS       = f"{BASE_URL}/profile-views"

# ─── Success Stories ─────────────────────────────────────────────────────────
SUCCESS_STORIES     = f"{BASE_URL}/success-stories"

# ─── Search ──────────────────────────────────────────────────────────────────
SEARCH              = f"{BASE_URL}/search"

# ─── Test Parameters ─────────────────────────────────────────────────────────
TOTAL_USERS         = 200          # Total simulated users
CONCURRENCY         = 10           # Concurrent user sessions
REQUEST_TIMEOUT     = 30.0         # Seconds per request
MAX_RETRIES         = 2            # Retries per failed flow
OTP_POLL_INTERVAL   = 2.0          # Seconds between OTP polls
OTP_POLL_TIMEOUT    = 60.0         # Max seconds to wait for OTP
PASSWORD            = "TestP@ss1234"  # Shared test password
TEST_SECRET         = "methna-qa-secret-2026"  # Must match TEST_SECRET env var on backend

# ─── Output ──────────────────────────────────────────────────────────────────
REPORTS_DIR         = "test_reports"
LOG_FILE            = f"{REPORTS_DIR}/methna_test.log"
SUMMARY_FILE        = f"{REPORTS_DIR}/summary_report.txt"
ERROR_FILE          = f"{REPORTS_DIR}/error_report.txt"
JSON_REPORT         = f"{REPORTS_DIR}/results.json"
