import asyncio
import base64
import os
import random
import re
import traceback
from typing import Literal

import uvicorn
from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI()

# ── Persistent browser state ──────────────────────────────────────────────────
# Chrome opens once on the first /check call and stays open for the life of
# the process. The _abck session cookie Akamai sets survives across all form
# submissions as long as the browser stays alive. Closing Chrome after every
# check throws away that trust token and forces Akamai to re-evaluate from zero.
_playwright = None
_context = None
_page = None
_context_lock = asyncio.Lock()   # guards context creation only (held briefly)
_check_lock = asyncio.Lock()     # serializes checks (one at a time on the shared page)


class CheckParams(BaseModel):
    ssn: str
    refund_amount: int
    tax_year: int
    filing_status: str
    client_name: str
    tax_case_id: str


class CheckResult(BaseModel):
    raw_status: str
    details: str
    result: Literal["success", "not_found", "error", "timeout"]
    screenshot_base64: str | None = None
    error_message: str | None = None


FILING_STATUS_SELECTOR = {
    "single": 'label[for="Single"]',
    "married_joint": 'label[for="MFJ"]',
    "married_separate": 'label[for="MFS"]',
    "head_of_household": 'label[for="HOH"]',
}


def jitter(base_ms: int) -> float:
    return (base_ms + 200 + random.randint(0, 800)) / 1000


async def _warmup(page) -> None:
    """Visit multiple IRS pages organically to build a trusted _abck session.
    Called only when a new context is created — not before every check."""
    pages_to_visit = [
        ("https://www.irs.gov/", "home"),
        ("https://www.irs.gov/refunds", "refunds"),
    ]
    for url, label in pages_to_visit:
        print(f"[WARMUP] Navigating to {label}...", flush=True)
        try:
            await page.goto(url, timeout=30000)
            await page.wait_for_load_state("domcontentloaded", timeout=10000)
        except Exception:
            pass
        await asyncio.sleep(jitter(2500))
        await page.mouse.wheel(0, 220 + random.randint(0, 280))
        await asyncio.sleep(jitter(1200))
        await page.mouse.move(280 + random.randint(0, 500), 180 + random.randint(0, 400))
        await asyncio.sleep(jitter(900))
        await page.mouse.wheel(0, 100 + random.randint(0, 150))
        await asyncio.sleep(jitter(1000))
        await page.mouse.wheel(0, -(70 + random.randint(0, 100)))
        await asyncio.sleep(jitter(800))

    print("[WARMUP] Context warmed up ✓", flush=True)


async def _close_context() -> None:
    global _playwright, _context, _page
    try:
        if _context:
            await _context.close()
    except Exception:
        pass
    try:
        if _playwright:
            await _playwright.stop()
    except Exception:
        pass
    _playwright = None
    _context = None
    _page = None


async def ensure_page():
    """Return the shared persistent page, creating a new context if needed."""
    global _playwright, _context, _page

    async with _context_lock:
        if _page is not None:
            try:
                await _page.evaluate("() => true")
                return _page
            except Exception:
                print("[CONTEXT] Page unresponsive — recreating context...", flush=True)
                await _close_context()

        print("[CONTEXT] Launching new persistent browser context...", flush=True)
        from playwright.async_api import async_playwright

        user_data_dir = os.path.join(os.path.dirname(__file__), ".browser-profile")
        os.makedirs(user_data_dir, exist_ok=True)

        _playwright = await async_playwright().start()
        _context = await _playwright.chromium.launch_persistent_context(
            user_data_dir,
            channel="chrome",
            headless=False,
            viewport=None,
        )
        _page = await _context.new_page()
        await _page.set_viewport_size({"width": 1280, "height": 900})

        await _warmup(_page)
        return _page


async def _try_recover_page(page) -> None:
    """After an error, navigate to a safe IRS page. If that fails, mark context dead."""
    global _page
    try:
        await page.goto("https://www.irs.gov/", timeout=15000)
    except Exception:
        _page = None  # ensure_page() will recreate the context on next call


async def run_check(params: CheckParams) -> CheckResult:
    page = await ensure_page()

    raw_status = ""
    result_code: Literal["success", "not_found", "error", "timeout"] = "success"

    try:
        for attempt in range(1, 3):
            await page.goto("https://sa.www4.irs.gov/wmr/", timeout=30000)
            try:
                await page.wait_for_load_state("networkidle", timeout=15000)
            except Exception:
                pass
            await asyncio.sleep(jitter(2000))

            # SSN
            await page.wait_for_selector('input[name="ssnInput"]', timeout=15000)
            await page.click('input[name="ssnInput"]')
            await page.keyboard.type(params.ssn, delay=jitter(60) * 1000)
            await asyncio.sleep(jitter(700))
            await asyncio.sleep(jitter(1500))

            # Tax year
            year_label = f'label[for="{params.tax_year}"]'
            await page.wait_for_selector(year_label, timeout=10000)
            await page.click(year_label)
            await asyncio.sleep(jitter(500))
            await asyncio.sleep(jitter(1500))

            # Filing status
            filing_sel = FILING_STATUS_SELECTOR.get(params.filing_status, 'label[for="Single"]')
            await page.wait_for_selector(filing_sel, timeout=10000)
            await page.click(filing_sel)
            await asyncio.sleep(jitter(500))
            await asyncio.sleep(jitter(1500))

            # Refund amount
            refund_sel = (
                'input[name*="refund" i], input[id*="refund" i], '
                'input[aria-label*="refund" i], input[placeholder*="refund" i]'
            )
            refund_loc = page.locator(refund_sel).first
            if await refund_loc.is_visible():
                await refund_loc.click()
            else:
                await page.get_by_label("refund amount", exact=False).first.click()
            await page.keyboard.type(str(params.refund_amount), delay=jitter(50) * 1000)
            await asyncio.sleep(jitter(700))
            await asyncio.sleep(jitter(2000))

            # Submit
            await page.wait_for_selector("a#anchor-ui-0", timeout=10000)
            await page.click("a#anchor-ui-0")

            try:
                await page.wait_for_function(
                    """() => {
                        const t = document.body?.textContent ?? '';
                        return /return received|refund approved|refund sent|we cannot provide|still being processed|take action|identity|verification|more information|unavailable|we are sorry/i.test(t);
                    }""",
                    timeout=25000,
                )
            except Exception:
                pass

            page_text = await page.evaluate("() => document.body.innerText ?? ''")
            akamai_blocked = bool(
                re.search(r"we are sorry|currently unavailable|try again later", page_text, re.I)
            )

            if akamai_blocked and attempt < 2:
                await asyncio.sleep(12 + random.uniform(0, 5))
                continue
            break

        await asyncio.sleep(jitter(1500))

        screenshot_base64 = None
        try:
            buf = await page.screenshot(type="png", full_page=True)
            screenshot_base64 = base64.b64encode(buf).decode()
        except Exception:
            pass

        body = await page.evaluate("() => document.body.textContent ?? ''")
        lower = body.lower()

        if "still being processed" in lower or "refund date will be provided" in lower:
            raw_status = "Return Received"
        elif "refund was sent to your bank" in lower or "sent to your bank" in lower:
            raw_status = "Refund Sent"
        elif "check was mailed" in lower or "mailed your refund" in lower:
            raw_status = "Refund Sent"
        elif "refund has been approved" in lower or "approved your refund" in lower:
            raw_status = "Refund Approved"
        elif "we received your tax return" in lower or "return has been received" in lower:
            raw_status = "Return Received"
        elif "cannot provide any information" in lower:
            raw_status = "Cannot Provide Information"
            result_code = "not_found"
        elif "take action" in lower or "action required" in lower or "we need more information" in lower:
            raw_status = "Action Required"
        elif "identity" in lower or "verification" in lower or "under review" in lower:
            raw_status = "Under Review"
        elif "we are sorry" in lower or "currently unavailable" in lower:
            raw_status = "Not Available"
            result_code = "error"  # Akamai block — not an IRS answer; NestJS falls back to Patchright

        if not raw_status:
            for sel in ["main h1", "main h2", "h1", "h2"]:
                try:
                    text = await page.text_content(sel)
                    if text and len(text.strip()) > 3:
                        raw_status = text.strip()
                        break
                except Exception:
                    pass

        if not raw_status:
            raw_status = "Could not extract status"

        # Navigate away from the WMR result page so the next check starts
        # from a neutral IRS page (not the result of the previous submission).
        try:
            await page.goto("https://www.irs.gov/refunds", timeout=15000)
            await page.wait_for_load_state("domcontentloaded", timeout=8000)
        except Exception:
            pass

        return CheckResult(
            raw_status=raw_status,
            details="",
            result=result_code,
            screenshot_base64=screenshot_base64,
        )

    except asyncio.TimeoutError:
        print("[ERROR] run_check: timed out", flush=True)
        await _try_recover_page(page)
        return CheckResult(raw_status="Timeout", details="", result="timeout", error_message="Timed out")

    except Exception as e:
        print(f"[ERROR] run_check exception: {e}\n{traceback.format_exc()}", flush=True)
        await _try_recover_page(page)
        return CheckResult(raw_status="Error", details="", result="error", error_message=str(e))


@app.post("/check", response_model=CheckResult)
async def check_refund(params: CheckParams):
    async with _check_lock:
        try:
            return await asyncio.wait_for(run_check(params), timeout=360)
        except asyncio.TimeoutError:
            return CheckResult(raw_status="Timeout", details="", result="timeout", error_message="Global timeout")


@app.post("/reset")
async def reset_browser():
    """Force-close and recreate the browser context. Use after repeated blocks."""
    async with _check_lock:
        async with _context_lock:
            await _close_context()
    return {"status": "reset", "message": "Browser context closed. Will reopen on next /check call."}


@app.get("/health")
def health():
    return {
        "status": "ok",
        "browser_alive": _page is not None,
    }


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8001, log_level="info")
