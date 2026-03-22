"""
Methna QA Test System — Full User Flow Simulation
Simulates one complete user journey: signup → OTP → profile → screens → actions.
"""

import asyncio
import logging
import random
import time
from dataclasses import dataclass, field

from api_client import MethnaAPIClient, APIResponse
import config as cfg

logger = logging.getLogger("methna.flow")


# ─── Flow Result ──────────────────────────────────────────────────────────────

@dataclass
class StepResult:
    step: str
    ok: bool
    latency_ms: float = 0.0
    error: str = ""
    status_code: int = 0


@dataclass
class FlowResult:
    user_index: int
    email: str
    success: bool = False
    steps: list[StepResult] = field(default_factory=list)
    total_time_ms: float = 0.0
    error_summary: str = ""
    retry_count: int = 0

    @property
    def failed_steps(self) -> list[StepResult]:
        return [s for s in self.steps if not s.ok]

    @property
    def avg_latency_ms(self) -> float:
        latencies = [s.latency_ms for s in self.steps if s.latency_ms > 0]
        return sum(latencies) / len(latencies) if latencies else 0.0


# ─── OTP Fetcher ──────────────────────────────────────────────────────────────

async def fetch_otp_code(client: MethnaAPIClient,
                         email: str) -> str | None:
    """
    Attempt to retrieve OTP from the backend.

    Strategy 1: Use /auth/test-otp endpoint (requires TEST_SECRET env var on backend).
    Strategy 2: Fall back to common dev OTPs (123456, etc.).
    """
    # Strategy 1: Fetch real OTP via test endpoint
    resp = await client.fetch_test_otp(email)
    if resp.ok and isinstance(resp.data, dict):
        otp = resp.data.get("otp")
        if otp:
            logger.info("[%s] Fetched real OTP via test endpoint: %s", client.user_id, otp)
            return otp

    # Strategy 2: Try common test/dev OTPs (only 1 attempt each to avoid rate limits)
    for otp in ["123456", "000000"]:
        verify_resp = await client.verify_otp(email, otp)
        if verify_resp.ok:
            return otp
        if verify_resp.status == 429:
            break
        await asyncio.sleep(0.3)

    return None


# ─── Single User Flow ────────────────────────────────────────────────────────

async def run_user_flow(user_data: dict, user_index: int) -> FlowResult:
    """Execute the complete user journey for a single simulated user."""
    email = user_data["email"]
    password = user_data["password"]
    meta = user_data.get("_meta", {})
    uid = f"user-{user_index:04d}"

    result = FlowResult(user_index=user_index, email=email)
    client = MethnaAPIClient(uid)
    flow_start = time.perf_counter()

    try:
        # ── Step 1: Register ──────────────────────────────────────────────
        resp = await client.register(user_data)
        result.steps.append(StepResult(
            step="register", ok=resp.ok, latency_ms=resp.latency_ms,
            error=resp.error, status_code=resp.status,
        ))
        if not resp.ok:
            # If 409 (already registered), try login instead
            if resp.status == 409:
                logger.info("[%s] Already registered, trying login", uid)
                resp = await client.login(email, password)
                result.steps.append(StepResult(
                    step="login_fallback", ok=resp.ok,
                    latency_ms=resp.latency_ms, error=resp.error,
                    status_code=resp.status,
                ))
                if not resp.ok:
                    result.error_summary = f"Register conflict + login failed: {resp.error[:200]}"
                    return result
                # Login succeeded — skip OTP, go to authenticated flow
            else:
                result.error_summary = f"Registration failed: {resp.error[:200]}"
                return result
        else:
            # ── Step 2: Fetch OTP & verify account ────────────────────────
            await asyncio.sleep(1)  # Brief wait for OTP to be stored
            otp_code = await fetch_otp_code(client, email)

            if otp_code:
                # We have the OTP code — now verify the account with it
                verify_resp = await client.verify_otp(email, otp_code)
                result.steps.append(StepResult(
                    step="verify_otp", ok=verify_resp.ok,
                    latency_ms=verify_resp.latency_ms,
                    error=verify_resp.error, status_code=verify_resp.status,
                ))
                if verify_resp.ok:
                    logger.info("[%s] OTP verified with code: %s", uid, otp_code)
                else:
                    logger.warning("[%s] OTP verify call failed: %s", uid, verify_resp.error[:100])
            else:
                result.steps.append(StepResult(
                    step="fetch_otp", ok=False, error="OTP_NOT_FETCHABLE",
                ))

            # If still no token, try resend + retry once
            if not client.access_token:
                resend_resp = await client.resend_otp(email)
                result.steps.append(StepResult(
                    step="resend_otp", ok=resend_resp.ok,
                    latency_ms=resend_resp.latency_ms,
                    error=resend_resp.error, status_code=resend_resp.status,
                ))
                await asyncio.sleep(2)
                otp_code = await fetch_otp_code(client, email)
                if otp_code:
                    verify_resp = await client.verify_otp(email, otp_code)
                    result.steps.append(StepResult(
                        step="verify_otp_retry", ok=verify_resp.ok,
                        latency_ms=verify_resp.latency_ms,
                        error=verify_resp.error, status_code=verify_resp.status,
                    ))

            # Last resort: try login (some flows may auto-activate)
            if not client.access_token:
                login_resp = await client.login(email, password)
                result.steps.append(StepResult(
                    step="login_after_otp_fail", ok=login_resp.ok,
                    latency_ms=login_resp.latency_ms,
                    error=login_resp.error, status_code=login_resp.status,
                ))
                if not login_resp.ok:
                    result.error_summary = "OTP verification failed, login also failed"
                    return result

        # ── At this point we should be authenticated ──────────────────────

        if not client.access_token:
            result.error_summary = "No access token after auth flow"
            result.steps.append(StepResult(
                step="auth_check", ok=False, error="NO_TOKEN",
            ))
            return result

        result.steps.append(StepResult(step="auth_check", ok=True))

        # ── Step 3: Get user profile (simulates splash → main) ───────────
        resp = await client.get_me()
        result.steps.append(StepResult(
            step="get_me", ok=resp.ok, latency_ms=resp.latency_ms,
            error=resp.error, status_code=resp.status,
        ))

        # ── Step 4: Create/update profile ─────────────────────────────────
        profile_payload = {
            "gender": meta.get("gender", "male"),
            "birthday": meta.get("birthday", "1995-01-15"),
            "bio": meta.get("bio", "Seeking a righteous partner"),
            "education": meta.get("education", "bachelors"),
            "maritalStatus": meta.get("marital_status", "never_married"),
            "profession": meta.get("profession", "Engineer"),
            "interests": meta.get("interests", ["reading", "travel"]),
        }
        resp = await client.create_or_update_profile(profile_payload)
        result.steps.append(StepResult(
            step="update_profile", ok=resp.ok, latency_ms=resp.latency_ms,
            error=resp.error, status_code=resp.status,
        ))

        # ── Step 5: Set location ──────────────────────────────────────────
        resp = await client.update_location(
            meta.get("latitude", 24.7136), meta.get("longitude", 46.6753),
        )
        result.steps.append(StepResult(
            step="update_location", ok=resp.ok, latency_ms=resp.latency_ms,
            error=resp.error, status_code=resp.status,
        ))

        # ── Step 6: Navigate through main screens ────────────────────────

        screen_calls = [
            ("screen_profile", client.get_profile),
            ("screen_matches", client.get_matches),
            ("screen_suggestions", client.get_suggestions),
            ("screen_discover", client.get_discover),
            ("screen_notifications", client.get_notifications),
            ("screen_unread_count", client.get_unread_count),
            ("screen_conversations", client.get_conversations),
            ("screen_chat_unread", client.get_chat_unread),
            ("screen_monetization", client.get_monetization_status),
            ("screen_limits", client.get_limits),
            ("screen_blocked_users", client.get_blocked_users),
            ("screen_subscription", client.get_subscription),
            ("screen_plans", client.get_plans),
            ("screen_photos", client.get_my_photos),
            ("screen_notif_settings", client.get_notification_settings),
            ("screen_profile_views", client.get_profile_views),
            ("screen_analytics", client.get_analytics),
            ("screen_success_stories", client.get_success_stories),
        ]

        for step_name, call_fn in screen_calls:
            resp = await call_fn()
            result.steps.append(StepResult(
                step=step_name, ok=resp.ok, latency_ms=resp.latency_ms,
                error=resp.error, status_code=resp.status,
            ))
            # Simulate human reading delay
            await asyncio.sleep(random.uniform(0.1, 0.4))

        # ── Step 7: Random actions (search, nearby, recommended) ─────────

        random_actions = [
            ("action_search", lambda: client.search("Fatima")),
            ("action_nearby", client.get_nearby),
            ("action_smart_suggest", client.get_smart_suggestions),
            ("action_recommended", client.get_recommended),
            ("action_who_liked_me", client.who_liked_me),
            ("action_refresh_token", client.refresh_tokens),
        ]
        random.shuffle(random_actions)
        for step_name, call_fn in random_actions[:4]:
            resp = await call_fn()
            result.steps.append(StepResult(
                step=step_name, ok=resp.ok, latency_ms=resp.latency_ms,
                error=resp.error, status_code=resp.status,
            ))
            await asyncio.sleep(random.uniform(0.1, 0.3))

        # ── Step 8: Logout ────────────────────────────────────────────────
        resp = await client.logout()
        result.steps.append(StepResult(
            step="logout", ok=resp.ok, latency_ms=resp.latency_ms,
            error=resp.error, status_code=resp.status,
        ))

        # ── Determine overall success ────────────────────────────────────
        critical_steps = {"register", "auth_check", "get_me", "login_fallback"}
        critical_failures = [s for s in result.steps
                             if s.step in critical_steps and not s.ok]
        result.success = len(critical_failures) == 0

        if not result.success:
            result.error_summary = "; ".join(
                f"{s.step}: {s.error[:80]}" for s in critical_failures
            )

    except Exception as e:
        result.error_summary = f"UNHANDLED_EXCEPTION: {type(e).__name__}: {e}"
        result.steps.append(StepResult(
            step="exception", ok=False, error=str(e),
        ))
        logger.exception("[%s] Flow crashed", uid)
    finally:
        result.total_time_ms = (time.perf_counter() - flow_start) * 1000
        await client.close()

    return result


# ─── Single User Flow with Retries ───────────────────────────────────────────

async def run_user_flow_with_retry(user_data: dict,
                                   user_index: int) -> FlowResult:
    """Run user flow with retry on failure."""
    for attempt in range(1 + cfg.MAX_RETRIES):
        result = await run_user_flow(user_data, user_index)
        result.retry_count = attempt
        if result.success:
            return result
        if attempt < cfg.MAX_RETRIES:
            logger.warning("[user-%04d] Attempt %d failed, retrying...",
                           user_index, attempt + 1)
            await asyncio.sleep(1 + attempt * 2)
    return result
