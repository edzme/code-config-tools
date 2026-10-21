# One-page site

## What this makes

A one-page personal site at `out/one-page-site/index.html` in your project folder: your name, a tagline, up to eight links, and up to four short sections, in one of three themes.

## Run

```
cd <project folder> && python3 <this folder>/scripts/run.py
```

It reads `one-page-site.inputs.json` from the project folder, or this folder's `inputs.example.json` when there is none, and writes the page and its files to `out/one-page-site/` in the project folder.

## Check

`out/one-page-site/index.html` exists and the person's name is inside `<h1>`: `grep '<h1>' out/one-page-site/index.html` prints one line with the name in it.

## Host

Open `out/one-page-site/index.html` in a browser, or serve it with `python3 -m http.server` from inside `out/one-page-site/`. A static host the person names takes the folder as it is. On a cloud agent such as Muse or Dot, put it online: the output folder is `out/one-page-site/`.

## Make it yours

Write `one-page-site.inputs.json` in the project folder, never in this folder. Copy `inputs.example.json` and change the values:

- `name`: the person's name, shown as the page title.
- `tagline`: one line under the name.
- `theme`: `plain`, `night`, or `paper`; `plain` when left out.
- `links`: up to eight `{ "label", "url" }` pairs, shown as a row of links.
- `sections`: up to four `{ "heading", "text" }` blocks, shown under the links.

Ask the person for their name, tagline, and links in one message, and take the theme as `plain` unless they name another. To restyle the page, edit `templates/index.html` or one of the files in `themes/`.
