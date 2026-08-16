#!/usr/bin/env python3
"""Wraps the artifact-format page into a complete HTML document for GitHub Pages.

`index.html` is authored as a fragment (no doctype/html/head/body) because the
Claude artifact host supplies those at publish time. Pages serves raw files, so
this adds the shell — one source, two targets, no fork to keep in sync.
"""
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DIST = ROOT / "dist"

TITLE = "Buddy"
DESCRIPTION = (
    "Tasks, routines and team work — Buddy reminds you when it's time to "
    "actually get things done. A playful desktop companion for Mac and Windows."
)
FAVICON = (
    "data:image/svg+xml,"
    "%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E"
    "%3Ctext y='.9em' font-size='90'%3E%F0%9F%90%A5%3C/text%3E%3C/svg%3E"
)

SHELL = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<meta name="description" content="{description}">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{description}">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="{favicon}">
<style>
  *,*::before,*::after{{box-sizing:border-box}}
  html{{-webkit-text-size-adjust:100%}}
  body{{margin:0}}
  img,svg{{max-width:100%}}
</style>
</head>
<body>
{body}
</body>
</html>
"""


def main() -> None:
    src = (ROOT / "index.html").read_text()

    # The fragment carries its own <title>; the shell owns it instead.
    body = re.sub(r"<title>.*?</title>\s*", "", src, count=1, flags=re.S)

    DIST.mkdir(exist_ok=True)
    (DIST / "index.html").write_text(
        SHELL.format(title=TITLE, description=DESCRIPTION, favicon=FAVICON, body=body)
    )

    # Pages would otherwise run the output through Jekyll.
    (DIST / ".nojekyll").write_text("")

    for extra in ("CNAME",):
        if (ROOT / extra).exists():
            shutil.copy(ROOT / extra, DIST / extra)

    size = (DIST / "index.html").stat().st_size
    print(f"wrote {DIST / 'index.html'} ({size / 1024:.1f} KB)")


if __name__ == "__main__":
    main()
