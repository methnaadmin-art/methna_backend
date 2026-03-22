"""
Methna QA Test System — Load Test Orchestrator
Runs N users concurrently using asyncio semaphore for controlled parallelism.
"""

import asyncio
import logging
import time

from fake_user import generate_users
from user_flow import run_user_flow_with_retry, FlowResult
import config as cfg

logger = logging.getLogger("methna.load")


async def run_load_test(
    total_users: int = cfg.TOTAL_USERS,
    concurrency: int = cfg.CONCURRENCY,
    progress_callback=None,
) -> list[FlowResult]:
    """
    Orchestrate the full load test.
    - Generates `total_users` fake users
    - Runs them through the full flow with `concurrency` parallelism
    - Calls `progress_callback(completed, total, result)` after each user
    """
    logger.info("Generating %d fake users...", total_users)
    users = generate_users(total_users)

    logger.info("Starting load test: %d users, %d concurrent", total_users, concurrency)

    sem = asyncio.Semaphore(concurrency)
    results: list[FlowResult] = []
    completed = 0
    start_time = time.perf_counter()

    async def run_with_semaphore(user_data: dict, index: int):
        nonlocal completed
        async with sem:
            result = await run_user_flow_with_retry(user_data, index)
            results.append(result)
            completed += 1
            if progress_callback:
                progress_callback(completed, total_users, result)
            return result

    # Launch all tasks (semaphore controls concurrency)
    tasks = [
        asyncio.create_task(run_with_semaphore(user, i))
        for i, user in enumerate(users)
    ]

    await asyncio.gather(*tasks, return_exceptions=True)

    elapsed = time.perf_counter() - start_time
    logger.info(
        "Load test complete: %d/%d succeeded in %.1fs",
        sum(1 for r in results if r.success), total_users, elapsed,
    )

    return results


async def run_quick_smoke_test(concurrency: int = 3) -> list[FlowResult]:
    """Run a quick smoke test with just 3 users for validation."""
    return await run_load_test(total_users=3, concurrency=concurrency)
