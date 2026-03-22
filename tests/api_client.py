"""
Methna QA Test System — Async API Client
Wraps all backend HTTP calls with timing, retries, and error capture.
"""

import time
import logging
import httpx
from typing import Any

import config as cfg

logger = logging.getLogger("methna.api")


class APIResponse:
    """Standardized response wrapper with timing metadata."""

    __slots__ = ("ok", "status", "data", "error", "latency_ms", "endpoint")

    def __init__(self, ok: bool, status: int, data: Any, error: str,
                 latency_ms: float, endpoint: str):
        self.ok = ok
        self.status = status
        self.data = data
        self.error = error
        self.latency_ms = latency_ms
        self.endpoint = endpoint

    def __repr__(self):
        tag = "OK" if self.ok else "FAIL"
        return f"<APIResponse {tag} {self.status} {self.endpoint} {self.latency_ms:.0f}ms>"


class MethnaAPIClient:
    """Async HTTP client for a single simulated user session."""

    def __init__(self, user_id: str):
        self.user_id = user_id
        self.access_token: str | None = None
        self.refresh_token: str | None = None
        self.timings: list[APIResponse] = []
        self._client = httpx.AsyncClient(
            timeout=httpx.Timeout(cfg.REQUEST_TIMEOUT),
            follow_redirects=True,
            headers={"Content-Type": "application/json"},
        )

    # ── Internal request helper ───────────────────────────────────────────────

    async def _request(self, method: str, url: str, *,
                       json: dict | None = None,
                       auth: bool = False) -> APIResponse:
        headers = {}
        if auth and self.access_token:
            headers["Authorization"] = f"Bearer {self.access_token}"

        start = time.perf_counter()
        try:
            resp = await self._client.request(method, url, json=json,
                                              headers=headers)
            latency = (time.perf_counter() - start) * 1000
            ok = 200 <= resp.status_code < 300
            try:
                data = resp.json()
            except Exception:
                data = resp.text

            error = "" if ok else str(data)
            result = APIResponse(ok, resp.status_code, data, error,
                                 latency, url)
        except httpx.TimeoutException:
            latency = (time.perf_counter() - start) * 1000
            result = APIResponse(False, 0, None, "TIMEOUT", latency, url)
        except httpx.ConnectError as e:
            latency = (time.perf_counter() - start) * 1000
            result = APIResponse(False, 0, None, f"CONNECTION_ERROR: {e}",
                                 latency, url)
        except Exception as e:
            latency = (time.perf_counter() - start) * 1000
            result = APIResponse(False, 0, None, f"UNEXPECTED: {e}",
                                 latency, url)

        self.timings.append(result)
        level = logging.DEBUG if result.ok else logging.WARNING
        logger.log(level, "[%s] %s → %s", self.user_id, result, result.error[:120] if result.error else "")
        return result

    # ── Auth: Public endpoints ────────────────────────────────────────────────

    async def register(self, user_data: dict) -> APIResponse:
        payload = {k: v for k, v in user_data.items() if not k.startswith("_")}
        return await self._request("POST", cfg.AUTH_REGISTER, json=payload)

    async def verify_otp(self, email: str, otp: str) -> APIResponse:
        resp = await self._request("POST", cfg.AUTH_VERIFY_OTP,
                                   json={"email": email, "otp": otp})
        if resp.ok and isinstance(resp.data, dict):
            self.access_token = resp.data.get("accessToken")
            self.refresh_token = resp.data.get("refreshToken")
        return resp

    async def resend_otp(self, email: str) -> APIResponse:
        return await self._request("POST", cfg.AUTH_RESEND_OTP,
                                   json={"email": email})

    async def fetch_test_otp(self, email: str) -> APIResponse:
        """Fetch OTP via the test-mode endpoint (requires TEST_SECRET on backend)."""
        url = f"{cfg.AUTH_TEST_OTP}?email={email}"
        headers = {}
        if cfg.TEST_SECRET:
            headers["x-test-secret"] = cfg.TEST_SECRET
        start = time.perf_counter()
        try:
            resp = await self._client.get(url, headers=headers)
            latency = (time.perf_counter() - start) * 1000
            ok = 200 <= resp.status_code < 300
            try:
                data = resp.json()
            except Exception:
                data = resp.text
            error = "" if ok else str(data)
            result = APIResponse(ok, resp.status_code, data, error, latency, url)
        except Exception as e:
            latency = (time.perf_counter() - start) * 1000
            result = APIResponse(False, 0, None, f"FETCH_OTP_ERROR: {e}", latency, url)
        self.timings.append(result)
        return result

    async def login(self, email: str, password: str) -> APIResponse:
        resp = await self._request("POST", cfg.AUTH_LOGIN,
                                   json={"email": email, "password": password})
        if resp.ok and isinstance(resp.data, dict):
            self.access_token = resp.data.get("accessToken")
            self.refresh_token = resp.data.get("refreshToken")
        return resp

    async def refresh_tokens(self) -> APIResponse:
        resp = await self._request("POST", cfg.AUTH_REFRESH,
                                   json={"refreshToken": self.refresh_token})
        if resp.ok and isinstance(resp.data, dict):
            self.access_token = resp.data.get("accessToken")
            self.refresh_token = resp.data.get("refreshToken")
        return resp

    async def logout(self) -> APIResponse:
        return await self._request("POST", cfg.AUTH_LOGOUT, auth=True)

    # ── User / Profile ───────────────────────────────────────────────────────

    async def get_me(self) -> APIResponse:
        return await self._request("GET", cfg.USERS_ME, auth=True)

    async def get_profile(self) -> APIResponse:
        return await self._request("GET", cfg.PROFILE_ME, auth=True)

    async def create_or_update_profile(self, profile: dict) -> APIResponse:
        return await self._request("PATCH", cfg.PROFILE_CREATE,
                                   json=profile, auth=True)

    async def update_location(self, lat: float, lng: float) -> APIResponse:
        return await self._request("PATCH", cfg.PROFILE_LOCATION,
                                   json={"latitude": lat, "longitude": lng},
                                   auth=True)

    async def update_preferences(self, prefs: dict) -> APIResponse:
        return await self._request("PATCH", cfg.PROFILE_PREFERENCES,
                                   json=prefs, auth=True)

    # ── Discovery / Matching ─────────────────────────────────────────────────

    async def get_matches(self) -> APIResponse:
        return await self._request("GET", cfg.MATCHES_LIST, auth=True)

    async def get_suggestions(self) -> APIResponse:
        return await self._request("GET", cfg.MATCHES_SUGGESTIONS, auth=True)

    async def get_discover(self) -> APIResponse:
        return await self._request("GET", cfg.MATCHES_DISCOVER, auth=True)

    async def get_nearby(self) -> APIResponse:
        return await self._request("GET", cfg.MATCHES_NEARBY, auth=True)

    async def get_smart_suggestions(self) -> APIResponse:
        return await self._request("GET", cfg.SMART_SUGGESTIONS, auth=True)

    async def get_recommended(self) -> APIResponse:
        return await self._request("GET", cfg.RECOMMENDED, auth=True)

    # ── Swipes ───────────────────────────────────────────────────────────────

    async def swipe(self, target_id: str, action: str,
                    message: str = "") -> APIResponse:
        payload: dict = {"targetUserId": target_id, "action": action}
        if message:
            payload["complimentMessage"] = message
        return await self._request("POST", cfg.SWIPE, json=payload, auth=True)

    async def who_liked_me(self) -> APIResponse:
        return await self._request("GET", cfg.WHO_LIKED_ME, auth=True)

    # ── Photos ───────────────────────────────────────────────────────────────

    async def get_my_photos(self) -> APIResponse:
        return await self._request("GET", cfg.PHOTOS_ME, auth=True)

    # ── Notifications ────────────────────────────────────────────────────────

    async def get_notifications(self) -> APIResponse:
        return await self._request("GET", cfg.NOTIFICATIONS, auth=True)

    async def get_unread_count(self) -> APIResponse:
        return await self._request("GET", cfg.NOTIF_UNREAD, auth=True)

    async def get_notification_settings(self) -> APIResponse:
        return await self._request("GET", cfg.NOTIF_SETTINGS, auth=True)

    # ── Chat ─────────────────────────────────────────────────────────────────

    async def get_conversations(self) -> APIResponse:
        return await self._request("GET", cfg.CONVERSATIONS, auth=True)

    async def get_chat_unread(self) -> APIResponse:
        return await self._request("GET", cfg.CHAT_UNREAD, auth=True)

    # ── Monetization ─────────────────────────────────────────────────────────

    async def get_monetization_status(self) -> APIResponse:
        return await self._request("GET", cfg.MONETIZATION_STATUS, auth=True)

    async def get_limits(self) -> APIResponse:
        return await self._request("GET", cfg.MONETIZATION_LIMITS, auth=True)

    # ── Reports ──────────────────────────────────────────────────────────────

    async def get_blocked_users(self) -> APIResponse:
        return await self._request("GET", cfg.BLOCKED_USERS, auth=True)

    # ── Subscriptions ────────────────────────────────────────────────────────

    async def get_subscription(self) -> APIResponse:
        return await self._request("GET", cfg.SUBSCRIPTION_ME, auth=True)

    async def get_plans(self) -> APIResponse:
        return await self._request("GET", cfg.SUBSCRIPTION_PLANS, auth=True)

    # ── Analytics ────────────────────────────────────────────────────────────

    async def get_analytics(self) -> APIResponse:
        return await self._request("GET", cfg.ANALYTICS_PROFILE, auth=True)

    # ── Profile Views ────────────────────────────────────────────────────────

    async def get_profile_views(self) -> APIResponse:
        return await self._request("GET", cfg.PROFILE_VIEWS, auth=True)

    # ── Success Stories ──────────────────────────────────────────────────────

    async def get_success_stories(self) -> APIResponse:
        return await self._request("GET", cfg.SUCCESS_STORIES, auth=True)

    # ── Search ───────────────────────────────────────────────────────────────

    async def search(self, query: str = "") -> APIResponse:
        url = f"{cfg.SEARCH}?q={query}" if query else cfg.SEARCH
        return await self._request("GET", url, auth=True)

    # ── Lifecycle ────────────────────────────────────────────────────────────

    async def close(self):
        await self._client.aclose()
