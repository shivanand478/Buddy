#!/usr/bin/env python3
"""Builds a browser-runnable test page for worker.js.

There is no Node on this machine, so the worker is exercised in a plain page:
`export default` becomes a global, D1 is replaced by an in-memory stand-in that
understands the handful of statements the worker actually issues, and Brevo is
replaced by a recorder. That tests the worker's own logic — routing, hashing,
expiry, attempt counting, rate limits — not Cloudflare's SQL engine.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "test" / "run.html"

worker = (ROOT / "worker.js").read_text()
worker = worker.replace("export default {", "const WORKER = {", 1)

poly = (ROOT / "test" / "polyfill.js").read_text()
mock = (ROOT / "test" / "mock-d1.js").read_text()
tests = (ROOT / "test" / "tests.js").read_text()

OUT.write_text(f"""<!doctype html>
<meta charset="utf-8">
<title>Buddy worker tests</title>
<style>
  body {{ font: 14px ui-monospace, Menlo, monospace; padding: 20px; background: #FBF8F1; color: #14313A; }}
  .pass {{ color: #2F7D5B; }} .fail {{ color: #C0392B; font-weight: 700; }}
  pre {{ white-space: pre-wrap; line-height: 1.6; }}
</style>
<pre id="out">running…</pre>
<script>
{poly}
{mock}
{worker}
{tests}
</script>
""")
print("wrote", OUT)
