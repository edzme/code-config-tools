"""Write a one-page site to out/one-page-site/ in the folder this runs in.

Reads one-page-site.inputs.json from the current folder, or the app's
inputs.example.json when there is none.
"""

import html
import json
import shutil
from pathlib import Path

APP = Path(__file__).resolve().parent.parent
PROJECT = Path.cwd()
INPUTS = PROJECT / "one-page-site.inputs.json"
OUT = PROJECT / "out" / "one-page-site"
THEMES = ("plain", "night", "paper", "dusk")


def read_inputs():
    path = INPUTS if INPUTS.is_file() else APP / "inputs.example.json"
    return path, json.loads(path.read_text(encoding="utf-8"))


def text(value):
    return html.escape(str(value or "").strip())


def main():
    path, inputs = read_inputs()
    name = text(inputs.get("name")) or "Your name"
    theme = inputs.get("theme") or "plain"
    if theme not in THEMES:
        raise SystemExit(f"theme must be one of {', '.join(THEMES)}, not {theme!r}")

    links = "\n".join(
        f'<a href="{text(link.get("url"))}">{text(link.get("label"))}</a>'
        for link in (inputs.get("links") or [])[:8]
    )
    sections = "\n".join(
        f"<section>\n<h2>{text(part.get('heading'))}</h2>\n<p>{text(part.get('text'))}</p>\n</section>"
        for part in (inputs.get("sections") or [])[:4]
    )
    page = (APP / "templates" / "index.html").read_text(encoding="utf-8")
    for key, value in (
        ("title", name),
        ("name", name),
        ("tagline", text(inputs.get("tagline"))),
        ("links", links),
        ("sections", sections),
    ):
        page = page.replace("{{" + key + "}}", value)

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "index.html").write_text(page, encoding="utf-8")
    shutil.copyfile(APP / "themes" / f"{theme}.css", OUT / "style.css")
    shutil.copyfile(APP / "assets" / "favicon.svg", OUT / "favicon.svg")
    shutil.copyfile(APP / "badge.js", OUT / "badge.js")
    print(f"Read {path}")
    print(f"Wrote {OUT / 'index.html'} in the {theme} theme")


if __name__ == "__main__":
    main()
