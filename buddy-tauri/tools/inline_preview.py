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
    "index.html": ["characters.js", "util.js", "api.js", "ask.js", "app.js"],
    "reminder.html": ["characters.js", "reminder.js"],
    "onboarding.html": ["characters.js", "util.js", "ask.js", "onboarding.js"],
    "auth.html": ["characters.js", "util.js", "api.js", "auth.js"],
}


def image_shim() -> str:
    """A <script> that resolves img/*.png to data URIs inside the preview.

    The preview page is served from a data: URL, so relative paths resolve to
    nothing and every character renders blank. String-replacing the paths does
    not work because most are built at runtime (`img/${id}.png`), so instead a
    map is injected and an observer rewrites any src as it appears.
    """
    import base64, json
    cache = {}
    for png in sorted((SRC / "img").glob("*.png")):
        cache["img/" + png.name] = ("data:image/png;base64,"
                                    + base64.b64encode(png.read_bytes()).decode())
    return (
        "<script>(function(){var M="
        + json.dumps(cache)
        + ";function fix(n){if(n.tagName==='IMG'){var s=n.getAttribute('src');"
          "if(s&&M[s])n.setAttribute('src',M[s]);}}"
          "new MutationObserver(function(rs){rs.forEach(function(r){"
          "r.addedNodes.forEach(function(n){if(n.nodeType===1){fix(n);"
          "n.querySelectorAll&&n.querySelectorAll('img').forEach(fix);}});"
          "if(r.type==='attributes')fix(r.target);});})"
          ".observe(document.documentElement,{childList:true,subtree:true,"
          "attributes:true,attributeFilter:['src']});"
          "document.addEventListener('DOMContentLoaded',function(){"
          "document.querySelectorAll('img').forEach(fix);});})();</script>"
    )


def strip_module(text: str) -> str:
    text = re.sub(r"^\s*import\s+.*?;\s*$", "", text, flags=re.M | re.S)
    # `export async function` and `export function` both have to survive the
    # strip, and an unhandled one kills the whole concatenated script.
    text = re.sub(r"^\s*export\s+(default\s+)?(async\s+)?(const|function|let|var|class)\s",
                  lambda m: (m.group(2) or "") + m.group(3) + " ", text, flags=re.M)
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
    # lambda repl: the JS is literal text, not a regex template — backslashes
    # in the source must not be read as escape sequences.
    shim = ""   # served over HTTP; relative image paths resolve normally
    html = re.sub(
        r'<script type="module"[^>]*></script>',
        lambda _m: f"{shim}\n<script>\n{stub}\n</script>\n<script>\n{js}\n</script>",
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
