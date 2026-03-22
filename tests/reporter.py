"""
Methna QA Test System — Reporter
Generates logs, summary report, error report, and JSON results.
"""

import json
import os
import time
from datetime import datetime, timezone
from typing import Any

from user_flow import FlowResult, StepResult
import config as cfg


def ensure_reports_dir():
    os.makedirs(cfg.REPORTS_DIR, exist_ok=True)


# ─── Aggregate Statistics ─────────────────────────────────────────────────────

def compute_stats(results: list[FlowResult]) -> dict[str, Any]:
    total = len(results)
    successes = sum(1 for r in results if r.success)
    failures = total - successes

    all_steps: list[StepResult] = []
    for r in results:
        all_steps.extend(r.steps)

    all_latencies = [s.latency_ms for s in all_steps if s.latency_ms > 0]
    failed_steps = [s for s in all_steps if not s.ok]
    total_requests = len(all_steps)
    failed_requests = len(failed_steps)

    # Per-endpoint breakdown
    endpoint_stats: dict[str, dict] = {}
    for s in all_steps:
        if s.step not in endpoint_stats:
            endpoint_stats[s.step] = {
                "count": 0, "ok": 0, "fail": 0,
                "latencies": [], "errors": [],
            }
        es = endpoint_stats[s.step]
        es["count"] += 1
        if s.ok:
            es["ok"] += 1
        else:
            es["fail"] += 1
            if s.error:
                es["errors"].append(s.error[:200])
        if s.latency_ms > 0:
            es["latencies"].append(s.latency_ms)

    endpoint_summary = {}
    for name, es in endpoint_stats.items():
        lats = es["latencies"]
        endpoint_summary[name] = {
            "total": es["count"],
            "success": es["ok"],
            "failed": es["fail"],
            "success_rate": f"{es['ok'] / es['count'] * 100:.1f}%" if es["count"] else "N/A",
            "avg_ms": round(sum(lats) / len(lats), 1) if lats else 0,
            "min_ms": round(min(lats), 1) if lats else 0,
            "max_ms": round(max(lats), 1) if lats else 0,
            "p95_ms": round(sorted(lats)[int(len(lats) * 0.95)] if lats else 0, 1),
            "unique_errors": list(set(es["errors"]))[:5],
        }

    # Sort by failure count descending
    endpoint_summary = dict(
        sorted(endpoint_summary.items(), key=lambda x: x[1]["failed"], reverse=True)
    )

    flow_times = [r.total_time_ms for r in results]
    retry_users = sum(1 for r in results if r.retry_count > 0)

    return {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "total_users": total,
        "successful_users": successes,
        "failed_users": failures,
        "success_rate": f"{successes / total * 100:.1f}%" if total else "N/A",
        "retry_users": retry_users,
        "total_api_requests": total_requests,
        "failed_api_requests": failed_requests,
        "api_failure_rate": f"{failed_requests / total_requests * 100:.1f}%" if total_requests else "N/A",
        "avg_latency_ms": round(sum(all_latencies) / len(all_latencies), 1) if all_latencies else 0,
        "min_latency_ms": round(min(all_latencies), 1) if all_latencies else 0,
        "max_latency_ms": round(max(all_latencies), 1) if all_latencies else 0,
        "p50_latency_ms": round(sorted(all_latencies)[len(all_latencies) // 2], 1) if all_latencies else 0,
        "p95_latency_ms": round(sorted(all_latencies)[int(len(all_latencies) * 0.95)], 1) if all_latencies else 0,
        "p99_latency_ms": round(sorted(all_latencies)[int(len(all_latencies) * 0.99)], 1) if all_latencies else 0,
        "avg_flow_time_ms": round(sum(flow_times) / len(flow_times), 1) if flow_times else 0,
        "endpoints": endpoint_summary,
    }


# ─── Root Cause Hints ────────────────────────────────────────────────────────

def diagnose_errors(stats: dict, results: list[FlowResult]) -> list[dict]:
    """Produce root-cause hints for the most common failure patterns."""
    issues: list[dict] = []

    # Check for timeout-dominant failures
    all_steps = [s for r in results for s in r.steps if not s.ok]
    timeout_count = sum(1 for s in all_steps if "TIMEOUT" in s.error)
    connection_count = sum(1 for s in all_steps if "CONNECTION" in s.error)
    otp_fails = sum(1 for s in all_steps if "OTP" in s.error)
    auth_fails = sum(1 for s in all_steps if s.step in ("register", "login_fallback") and not s.ok)

    if timeout_count > len(all_steps) * 0.2:
        issues.append({
            "severity": "CRITICAL",
            "category": "TIMEOUT",
            "count": timeout_count,
            "hint": "Over 20% of requests are timing out. Possible causes:\n"
                    "  - Backend server overloaded (check CPU/memory on Railway)\n"
                    "  - Database connection pool exhausted\n"
                    "  - Network latency between test runner and Railway\n"
                    "  - Request timeout too low (currently {:.0f}s)".format(cfg.REQUEST_TIMEOUT),
        })

    if connection_count > 5:
        issues.append({
            "severity": "CRITICAL",
            "category": "CONNECTION_ERROR",
            "count": connection_count,
            "hint": "Multiple connection errors detected. Possible causes:\n"
                    "  - Railway backend is down or restarting\n"
                    "  - DNS resolution failure\n"
                    "  - Rate limiting by Railway/Cloudflare\n"
                    "  - Too many concurrent connections from same IP",
        })

    if otp_fails > 0:
        issues.append({
            "severity": "HIGH",
            "category": "OTP_FAILURE",
            "count": otp_fails,
            "hint": "OTP verification failed. Possible causes:\n"
                    "  - SMTP credentials (MAIL_USER/MAIL_PASS) not configured\n"
                    "  - OTP test codes (123456) not accepted in production\n"
                    "  - OTP already expired (5-minute window)\n"
                    "  - Rate limiting on OTP verification endpoint",
        })

    if auth_fails > len(results) * 0.3:
        issues.append({
            "severity": "HIGH",
            "category": "AUTH_FAILURE",
            "count": auth_fails,
            "hint": "High auth failure rate. Possible causes:\n"
                    "  - Password validation regex rejecting test passwords\n"
                    "  - Email uniqueness constraint (duplicate test runs)\n"
                    "  - Database write contention under load",
        })

    # Check for slow endpoints
    for name, ep in stats.get("endpoints", {}).items():
        if ep["avg_ms"] > 5000:
            issues.append({
                "severity": "MEDIUM",
                "category": "SLOW_ENDPOINT",
                "count": ep["total"],
                "hint": f"Endpoint '{name}' averaging {ep['avg_ms']}ms.\n"
                        f"  - Check database query performance\n"
                        f"  - Look for N+1 queries in the service\n"
                        f"  - Consider adding DB indexes or caching",
            })

    # Check for 401/403 patterns
    unauth_steps = [s for r in results for s in r.steps
                    if s.status_code in (401, 403) and s.step.startswith("screen_")]
    if len(unauth_steps) > 5:
        issues.append({
            "severity": "HIGH",
            "category": "AUTH_TOKEN_ISSUE",
            "count": len(unauth_steps),
            "hint": "Authenticated endpoints returning 401/403. Possible causes:\n"
                    "  - JWT token expired before flow completed\n"
                    "  - Token not properly set after login/verify\n"
                    "  - Guard misconfiguration on backend routes",
        })

    if not issues:
        issues.append({
            "severity": "INFO",
            "category": "ALL_CLEAR",
            "count": 0,
            "hint": "No major issues detected. All flows appear healthy.",
        })

    return issues


# ─── Write Reports ────────────────────────────────────────────────────────────

def write_summary_report(stats: dict, issues: list[dict], elapsed_sec: float):
    ensure_reports_dir()
    lines = []
    lines.append("=" * 72)
    lines.append("  METHNA QA TEST — SUMMARY REPORT")
    lines.append(f"  Generated: {stats['timestamp']}")
    lines.append(f"  Total Duration: {elapsed_sec:.1f}s")
    lines.append("=" * 72)
    lines.append("")

    lines.append("── USER FLOW RESULTS ──────────────────────────────────────")
    lines.append(f"  Total Users Simulated:  {stats['total_users']}")
    lines.append(f"  Successful Flows:       {stats['successful_users']}")
    lines.append(f"  Failed Flows:           {stats['failed_users']}")
    lines.append(f"  Success Rate:           {stats['success_rate']}")
    lines.append(f"  Users That Retried:     {stats['retry_users']}")
    lines.append("")

    lines.append("── API PERFORMANCE ────────────────────────────────────────")
    lines.append(f"  Total API Requests:     {stats['total_api_requests']}")
    lines.append(f"  Failed API Requests:    {stats['failed_api_requests']}")
    lines.append(f"  API Failure Rate:       {stats['api_failure_rate']}")
    lines.append(f"  Avg Latency:            {stats['avg_latency_ms']}ms")
    lines.append(f"  Min Latency:            {stats['min_latency_ms']}ms")
    lines.append(f"  Max Latency:            {stats['max_latency_ms']}ms")
    lines.append(f"  P50 Latency:            {stats['p50_latency_ms']}ms")
    lines.append(f"  P95 Latency:            {stats['p95_latency_ms']}ms")
    lines.append(f"  P99 Latency:            {stats['p99_latency_ms']}ms")
    lines.append(f"  Avg Flow Time:          {stats['avg_flow_time_ms']:.0f}ms")
    lines.append("")

    lines.append("── PER-ENDPOINT BREAKDOWN ─────────────────────────────────")
    lines.append(f"  {'Endpoint':<28} {'Total':>6} {'OK':>6} {'Fail':>6} {'Rate':>7} {'Avg':>8} {'P95':>8}")
    lines.append(f"  {'─' * 28} {'─' * 6} {'─' * 6} {'─' * 6} {'─' * 7} {'─' * 8} {'─' * 8}")
    for name, ep in stats["endpoints"].items():
        lines.append(
            f"  {name:<28} {ep['total']:>6} {ep['success']:>6} "
            f"{ep['failed']:>6} {ep['success_rate']:>7} "
            f"{ep['avg_ms']:>7.0f}ms {ep['p95_ms']:>7.0f}ms"
        )
    lines.append("")

    lines.append("── DIAGNOSTICS & ROOT CAUSE HINTS ─────────────────────────")
    for issue in issues:
        lines.append(f"  [{issue['severity']}] {issue['category']} (×{issue['count']})")
        for hint_line in issue["hint"].split("\n"):
            lines.append(f"    {hint_line}")
        lines.append("")

    lines.append("=" * 72)

    report_text = "\n".join(lines)
    with open(cfg.SUMMARY_FILE, "w", encoding="utf-8") as f:
        f.write(report_text)

    return report_text


def write_error_report(results: list[FlowResult], issues: list[dict]):
    ensure_reports_dir()
    lines = []
    lines.append("=" * 72)
    lines.append("  METHNA QA TEST — ERROR REPORT")
    lines.append("=" * 72)
    lines.append("")

    failed = [r for r in results if not r.success]
    if not failed:
        lines.append("  ✅ No failed user flows. All users completed successfully.")
    else:
        lines.append(f"  Total Failed Flows: {len(failed)}")
        lines.append("")
        for r in failed:
            lines.append(f"  ── User #{r.user_index} ({r.email}) ──")
            lines.append(f"     Retries: {r.retry_count}")
            lines.append(f"     Flow Time: {r.total_time_ms:.0f}ms")
            lines.append(f"     Error: {r.error_summary}")
            lines.append(f"     Failed Steps:")
            for s in r.failed_steps:
                lines.append(
                    f"       - {s.step}: HTTP {s.status_code} | "
                    f"{s.latency_ms:.0f}ms | {s.error[:120]}"
                )
            lines.append("")

    lines.append("")
    lines.append("── ROOT CAUSE ANALYSIS ────────────────────────────────────")
    for issue in issues:
        lines.append(f"  [{issue['severity']}] {issue['category']}")
        for hint_line in issue["hint"].split("\n"):
            lines.append(f"    {hint_line}")
        lines.append("")

    lines.append("=" * 72)

    with open(cfg.ERROR_FILE, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))


def write_json_report(stats: dict, results: list[FlowResult], issues: list[dict]):
    ensure_reports_dir()
    data = {
        "stats": stats,
        "diagnostics": issues,
        "failed_users": [
            {
                "index": r.user_index,
                "email": r.email,
                "success": r.success,
                "retries": r.retry_count,
                "total_time_ms": round(r.total_time_ms, 1),
                "error": r.error_summary,
                "failed_steps": [
                    {"step": s.step, "status": s.status_code,
                     "latency_ms": round(s.latency_ms, 1), "error": s.error[:200]}
                    for s in r.failed_steps
                ],
            }
            for r in results if not r.success
        ],
    }
    with open(cfg.JSON_REPORT, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, default=str)
