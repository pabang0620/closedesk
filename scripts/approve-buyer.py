#!/usr/bin/env python3
"""Approves the pending sandbox orders of one prepared period as the sandbox buyer (headless Chromium).

Usage: python3 scripts/approve-buyer.py <periodId>
Needs: pip install playwright && playwright install chromium
Credentials: SANDBOX_BUYER_EMAIL and SANDBOX_BUYER_PASSWORD from the environment first, then from .env.
It only approves; it never captures. `node scripts/seed-period.js finish <periodId>` does that afterwards.
The PayPal sandbox login page changes now and then: if a selector below stops matching, the script
saves a screenshot to .scratch/approve-<orderNo>.png and moves on to the next order.
"""
import json
import os
import re
import sys
from pathlib import Path

from playwright.sync_api import TimeoutError as PlaywrightTimeout
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent


def env_value(name):
    if os.environ.get(name):
        return os.environ[name]
    env_file = ROOT / ".env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            if line.startswith(f"{name}="):
                return line.split("=", 1)[1].strip()
    return ""


def chromium_path():
    """CHROMIUM_PATH first, else the newest chromium under ~/.cache/ms-playwright (the pip build may expect another)."""
    if os.environ.get("CHROMIUM_PATH"):
        return os.environ["CHROMIUM_PATH"]
    found = sorted(Path.home().glob(".cache/ms-playwright/chromium-*/chrome-linux64/chrome"))
    return str(found[-1]) if found else None


def approve(page, url, order_no):
    page.goto(url, wait_until="domcontentloaded")
    try:
        email = page.locator("#email")
        if email.is_visible(timeout=8000):
            email.fill(BUYER_EMAIL)
            if page.locator("#btnNext").is_visible():
                page.locator("#btnNext").click()
            page.locator("#password").fill(BUYER_PASSWORD)
            page.locator("#btnLogin").click()
        button = page.locator("button#payment-submit-btn, button[data-id='payment-submit-btn'], button:has-text('Complete Purchase'), button:has-text('Pay Now'), button:has-text('Continue')").first
        button.wait_for(timeout=30000)
        button.click()
        page.wait_for_url(re.compile(r"seed-return|token="), timeout=45000)
        return True
    except PlaywrightTimeout:
        (ROOT / ".scratch").mkdir(exist_ok=True)
        page.screenshot(path=str(ROOT / ".scratch" / f"approve-{order_no}.png"))
        return False


if len(sys.argv) != 2 or not re.fullmatch(r"[A-Za-z0-9]{3,14}", sys.argv[1]):
    sys.exit("Usage: python3 scripts/approve-buyer.py <periodId>")
BUYER_EMAIL = env_value("SANDBOX_BUYER_EMAIL")
BUYER_PASSWORD = env_value("SANDBOX_BUYER_PASSWORD")
if not BUYER_EMAIL or not BUYER_PASSWORD:
    sys.exit("Set SANDBOX_BUYER_EMAIL and SANDBOX_BUYER_PASSWORD.")

record = json.loads((ROOT / "data" / "periods" / f"{sys.argv[1]}.json").read_text())
pending = record["manifest"]["pending"]
approved = 0
with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True, executable_path=chromium_path())
    for item in pending:
        context = browser.new_context()  # a fresh login per order keeps one stuck order from blocking the rest
        ok = item["approveUrl"] and approve(context.new_page(), item["approveUrl"], item["orderNo"])
        approved += 1 if ok else 0
        print(f"{item['key']}: {'approved' if ok else 'NOT approved'}")
        context.close()
    browser.close()
print(f"{approved}/{len(pending)} approved")
sys.exit(0 if approved == len(pending) else 2)
