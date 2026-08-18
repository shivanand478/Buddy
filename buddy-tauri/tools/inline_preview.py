#!/usr/bin/env python3
"""Flattens a Buddy window into one self-contained HTML file for visual review.

Inlines the stylesheet and concatenates the ES modules into a single classic
script (stripping import/export), so the page can be opened anywhere without a
module loader or the Tauri bridge. Preview only — the app itself uses the real
module files.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src"
PREVIEW = ROOT / ".preview"

ENTRY = {
    "index.html": ["characters.js", "util.js", "ask.js", "app.js"],
    "reminder.html": ["characters.js", "reminder.js"],
    "onboarding.html": ["characters.js", "util.js", "onboarding.js"],
}


def strip_module(text: str) -> str:
    text = re.sub(r"^\s*import\s+.*?;\s*$", "", text, flags=re.M | re.S)
    text = re.sub(r"^\s*export\s+(const|function|let|var)\s", r"\1 ", text, flags=re.M)
    text = re.sub(r"^\s*export\s*\{[^}]*\};?\s*$", "", text, flags=re.M)
    return text


def build(name: str) -> Path:
    html = (SRC / name).read_text()
    css = (SRC / "app.css").read_text()
    stub = (ROOT / "tools" / "preview-stub.js").read_text()

    js = "\n".join(strip_module((SRC / f).read_text()) for f in ENTRY[name])

    # inline the stylesheet
    html = html.replace(
        '<link rel="stylesheet" href="app.css">', f"<style>\n{css}\n</style>"
    )
    # replace the module tag with everything, inlined
    html = re.sub(
        r'<script type="module"[^>]*></script>',
        f"<script>\n{stub}\n</script>\n<script>\n{js}\n</script>",
        html,
    )

    out = PREVIEW / f"flat-{name}"
    out.write_text(html)
    return out


if __name__ == "__main__":
    PREVIEW.mkdir(exist_ok=True)
    targets = sys.argv[1:] or list(ENTRY)
    for t in targets:
        print("wrote", build(t))
