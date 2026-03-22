#!/usr/bin/env python3
"""
Methna QA Test System — Main Entry Point
═══════════════════════════════════════════
Run with:
    python run_tests.py                   # Full 200-user load test
    python run_tests.py --users 10        # Custom user count
    python run_tests.py --smoke           # Quick 3-user smoke test
    python run_tests.py --users 50 --concurrency 20
"""

import argparse
import asyncio
import logging
import os
import sys
import time

import config as cfg
from load_test import run_load_test, run_quick_smoke_test
from reporter import (
    compute_stats,
    diagnose_errors,
    write_summary_report,
    write_error_report,
    write_json_report,
    ensure_reports_dir,
)

# ─── Try rich for pretty output, fallback to plain ───────────────────────────
try:
    from rich.console import Console
    from rich.table import Table
    from rich.live import Live
    from rich.panel import Panel
    from rich.progress import Progress, SpinnerColumn, BarColumn, TextColumn, TimeElapsedColumn
    from rich.text import Text
    HAS_RICH = True
except ImportError:
    HAS_RICH = False


# ─── Logging Setup ───────────────────────────────────────────────────────────

def setup_logging():
    ensure_reports_dir()
    root = logging.getLogger()
    root.setLevel(logging.DEBUG)

    # File handler — everything
    fh = logging.FileHandler(cfg.LOG_FILE, mode="w", encoding="utf-8")
    fh.setLevel(logging.DEBUG)
    fh.setFormatter(logging.Formatter(
        "%(asctime)s | %(levelname)-7s | %(name)s | %(message)s",
        datefmt="%H:%M:%S",
    ))
    root.addHandler(fh)

    # Console handler — warnings+ only (dashboard handles the rest)
    ch = logging.StreamHandler()
    ch.setLevel(logging.WARNING)
    ch.setFormatter(logging.Formatter("%(levelname)s: %(message)s"))
    root.addHandler(ch)


# ─── Rich CLI Dashboard ─────────────────────────────────────────────────────

class Dashboard:
    def __init__(self, total_users: int):
        self.total = total_users
        self.completed = 0
        self.successes = 0
        self.failures = 0
        self.latest_user = ""
        self.latest_status = ""

        if HAS_RICH:
            self.console = Console()
            self.progress = Progress(
                SpinnerColumn(),
                TextColumn("[bold blue]{task.description}"),
                BarColumn(bar_width=40),
                TextColumn("[progress.percentage]{task.percentage:>3.0f}%"),
                TextColumn("({task.completed}/{task.total})"),
                TimeElapsedColumn(),
                console=self.console,
            )
            self.task_id = self.progress.add_task("Running users", total=total_users)
        else:
            self.console = None
            self.progress = None

    def update(self, completed, total, result):
        self.completed = completed
        if result.success:
            self.successes += 1
        else:
            self.failures += 1
        self.latest_user = result.email
        self.latest_status = "✅" if result.success else "❌"

        if self.progress:
            self.progress.update(self.task_id, completed=completed)
        else:
            pct = completed / total * 100
            bar_len = 40
            filled = int(bar_len * completed / total)
            bar = "█" * filled + "░" * (bar_len - filled)
            status = "OK" if result.success else "FAIL"
            sys.stdout.write(
                f"\r  [{bar}] {pct:5.1f}% ({completed}/{total}) "
                f"| OK:{self.successes} FAIL:{self.failures} "
                f"| {result.email[:30]} → {status}   "
            )
            sys.stdout.flush()

    def start(self):
        if HAS_RICH:
            self.console.print(Panel.fit(
                "[bold magenta]METHNA QA TEST SYSTEM[/bold magenta]\n"
                f"[dim]Users: {self.total} | Concurrency: {cfg.CONCURRENCY} | "
                f"Backend: {cfg.BASE_URL}[/dim]",
                border_style="bright_blue",
            ))
            self.progress.start()
        else:
            print("=" * 60)
            print("  METHNA QA TEST SYSTEM")
            print(f"  Users: {self.total} | Concurrency: {cfg.CONCURRENCY}")
            print(f"  Backend: {cfg.BASE_URL}")
            print("=" * 60)

    def stop(self):
        if self.progress:
            self.progress.stop()
        else:
            print()  # newline after progress bar

    def print_results(self, stats, issues, elapsed):
        if HAS_RICH:
            self._rich_results(stats, issues, elapsed)
        else:
            self._plain_results(stats, issues, elapsed)

    def _rich_results(self, stats, issues, elapsed):
        c = self.console
        c.print()

        # ── Summary table ──
        t = Table(title="📊 Test Results Summary", show_header=False,
                  border_style="bright_blue", padding=(0, 2))
        t.add_column("Metric", style="bold")
        t.add_column("Value", style="cyan")

        t.add_row("Total Users", str(stats["total_users"]))
        t.add_row("Successful", f"[green]{stats['successful_users']}[/green]")
        t.add_row("Failed", f"[red]{stats['failed_users']}[/red]")
        t.add_row("Success Rate", f"[bold]{stats['success_rate']}[/bold]")
        t.add_row("Retried Users", str(stats["retry_users"]))
        t.add_row("─" * 20, "─" * 20)
        t.add_row("Total API Requests", str(stats["total_api_requests"]))
        t.add_row("Failed Requests", str(stats["failed_api_requests"]))
        t.add_row("API Failure Rate", stats["api_failure_rate"])
        t.add_row("─" * 20, "─" * 20)
        t.add_row("Avg Latency", f"{stats['avg_latency_ms']}ms")
        t.add_row("P95 Latency", f"{stats['p95_latency_ms']}ms")
        t.add_row("P99 Latency", f"{stats['p99_latency_ms']}ms")
        t.add_row("Avg Flow Time", f"{stats['avg_flow_time_ms']:.0f}ms")
        t.add_row("─" * 20, "─" * 20)
        t.add_row("Total Duration", f"{elapsed:.1f}s")
        c.print(t)
        c.print()

        # ── Top endpoints by failure ──
        ep_table = Table(title="🔍 Endpoint Breakdown (sorted by failures)",
                         border_style="dim")
        ep_table.add_column("Endpoint", style="bold", width=28)
        ep_table.add_column("Total", justify="right")
        ep_table.add_column("OK", justify="right", style="green")
        ep_table.add_column("Fail", justify="right", style="red")
        ep_table.add_column("Rate", justify="right")
        ep_table.add_column("Avg ms", justify="right")
        ep_table.add_column("P95 ms", justify="right")

        for name, ep in list(stats["endpoints"].items())[:20]:
            fail_style = "red bold" if ep["failed"] > 0 else ""
            ep_table.add_row(
                name,
                str(ep["total"]),
                str(ep["success"]),
                Text(str(ep["failed"]), style=fail_style),
                ep["success_rate"],
                f"{ep['avg_ms']:.0f}",
                f"{ep['p95_ms']:.0f}",
            )
        c.print(ep_table)
        c.print()

        # ── Diagnostics ──
        for issue in issues:
            sev = issue["severity"]
            color = {"CRITICAL": "red", "HIGH": "yellow", "MEDIUM": "blue",
                     "INFO": "green"}.get(sev, "white")
            c.print(Panel(
                f"[bold]{issue['category']}[/bold] (×{issue['count']})\n\n{issue['hint']}",
                title=f"[{color}]{sev}[/{color}]",
                border_style=color,
            ))

        # ── File locations ──
        c.print(f"\n[dim]📁 Reports written to:[/dim]")
        c.print(f"   [cyan]{os.path.abspath(cfg.SUMMARY_FILE)}[/cyan]")
        c.print(f"   [cyan]{os.path.abspath(cfg.ERROR_FILE)}[/cyan]")
        c.print(f"   [cyan]{os.path.abspath(cfg.JSON_REPORT)}[/cyan]")
        c.print(f"   [cyan]{os.path.abspath(cfg.LOG_FILE)}[/cyan]")
        c.print()

    def _plain_results(self, stats, issues, elapsed):
        print("\n" + "=" * 60)
        print("  TEST RESULTS SUMMARY")
        print("=" * 60)
        print(f"  Total Users:       {stats['total_users']}")
        print(f"  Successful:        {stats['successful_users']}")
        print(f"  Failed:            {stats['failed_users']}")
        print(f"  Success Rate:      {stats['success_rate']}")
        print(f"  Total Requests:    {stats['total_api_requests']}")
        print(f"  Failed Requests:   {stats['failed_api_requests']}")
        print(f"  Avg Latency:       {stats['avg_latency_ms']}ms")
        print(f"  P95 Latency:       {stats['p95_latency_ms']}ms")
        print(f"  Duration:          {elapsed:.1f}s")
        print()
        print("  DIAGNOSTICS:")
        for issue in issues:
            print(f"  [{issue['severity']}] {issue['category']} (x{issue['count']})")
            print(f"    {issue['hint'][:120]}")
        print()
        print(f"  Reports: {os.path.abspath(cfg.REPORTS_DIR)}/")
        print("=" * 60)


# ─── Main ────────────────────────────────────────────────────────────────────

async def main():
    parser = argparse.ArgumentParser(description="Methna QA Load Test System")
    parser.add_argument("--users", type=int, default=cfg.TOTAL_USERS,
                        help=f"Number of simulated users (default: {cfg.TOTAL_USERS})")
    parser.add_argument("--concurrency", type=int, default=cfg.CONCURRENCY,
                        help=f"Concurrent user sessions (default: {cfg.CONCURRENCY})")
    parser.add_argument("--smoke", action="store_true",
                        help="Quick 3-user smoke test")
    parser.add_argument("--timeout", type=float, default=cfg.REQUEST_TIMEOUT,
                        help=f"Request timeout in seconds (default: {cfg.REQUEST_TIMEOUT})")
    args = parser.parse_args()

    # Override config from CLI
    if args.timeout != cfg.REQUEST_TIMEOUT:
        cfg.REQUEST_TIMEOUT = args.timeout
    if args.concurrency != cfg.CONCURRENCY:
        cfg.CONCURRENCY = args.concurrency

    setup_logging()
    logger = logging.getLogger("methna.main")

    total_users = 3 if args.smoke else args.users
    concurrency = min(3, total_users) if args.smoke else args.concurrency

    dashboard = Dashboard(total_users)
    dashboard.start()

    start_time = time.perf_counter()

    if args.smoke:
        results = await run_quick_smoke_test(concurrency=concurrency)
        # Wire up dashboard counts
        for r in results:
            dashboard.update(results.index(r) + 1, len(results), r)
    else:
        results = await run_load_test(
            total_users=total_users,
            concurrency=concurrency,
            progress_callback=dashboard.update,
        )

    elapsed = time.perf_counter() - start_time
    dashboard.stop()

    # ── Generate reports ──
    logger.info("Generating reports...")
    stats = compute_stats(results)
    issues = diagnose_errors(stats, results)

    summary_text = write_summary_report(stats, issues, elapsed)
    write_error_report(results, issues)
    write_json_report(stats, results, issues)

    # ── Display results ──
    dashboard.print_results(stats, issues, elapsed)

    # ── Exit code ──
    success_rate = stats["successful_users"] / stats["total_users"] * 100 if stats["total_users"] else 0
    sys.exit(0 if success_rate >= 50 else 1)


if __name__ == "__main__":
    asyncio.run(main())
