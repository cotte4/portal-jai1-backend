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


async def run_check(params: CheckParams) -> CheckResult:
    from playwright.async_api import async_playwright

    user_data_dir = os.path.join(os.path.dirname(__file__), ".browser-profile")
    os.makedirs(user_data_dir, exist_ok=True)

    async with async_playwright() as pw:
        # channel='chrome' uses the real installed Chrome binary — same approach
        # as Patchright. viewport=None means no forced viewport (window size used).
        context = await pw.chromium.launch_persistent_context(
            user_data_dir,
            channel="chrome",
            headless=False,
            viewport=None,
        )

        # Always open a fresh page — existing pages in a persistent context can
        # be stale/closed from the previous session.
        page = await context.new_page()
        await page.set_viewport_size({"width": 1280, "height": 900})

        raw_status = ""
        result_code: Literal["success", "not_found", "error", "timeout"] = "success"

        try:
            # Warm-up on irs.gov
            await page.goto("https://www.irs.gov/", timeout=30000)
            await page.wait_for_load_state("domcontentloaded", timeout=10000)
            await asyncio.sleep(jitter(2000))
            await page.mouse.wheel(0, 200)
            await asyncio.sleep(jitter(1500))

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
                result_code = "not_found"

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

            return CheckResult(
                raw_status=raw_status,
                details="",
                result=result_code,
                screenshot_base64=screenshot_base64,
            )

        except asyncio.TimeoutError:
            print("[ERROR] run_check: timed out", flush=True)
            return CheckResult(raw_status="Timeout", details="", result="timeout", error_message="Timed out")
        except Exception as e:
            print(f"[ERROR] run_check exception: {e}\n{traceback.format_exc()}", flush=True)
            return CheckResult(raw_status="Error", details="", result="error", error_message=str(e))
        finally:
            try:
                await context.close()
            except Exception:
                pass


@app.post("/check", response_model=CheckResult)
async def check_refund(params: CheckParams):
    try:
        return await asyncio.wait_for(run_check(params), timeout=360)
    except asyncio.TimeoutError:
        return CheckResult(raw_status="Timeout", details="", result="timeout", error_message="Global timeout")


@app.get("/health")
def health():
    return {"status": "ok"}


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8001, log_level="info")
