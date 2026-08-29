# Fonts

Self-hosted so the app makes no third-party requests. Serving these from
Google Fonts would send every visitor's IP address and User-Agent to Google,
including on the authenticated `/all` pages, and would force the
Content-Security-Policy to allow external hosts for `style-src` and
`font-src`.

Only the `latin` and `latin-ext` subsets are included. Japanese text falls
back to the system font stack, and each `@font-face` declares a
`unicode-range`, so a browser downloads a subset only when the page actually
uses characters from it.

| Family     | Files                                     | Notes                                 |
| ---------- | ----------------------------------------- | ------------------------------------- |
| DM Mono    | `dm-mono-{300,400,500}-{latin,latin-ext}` | Static instances, one file per weight |
| Manrope    | `manrope-variable-{latin,latin-ext}`      | Variable font, covers weights 400–700 |
| Newsreader | `newsreader-variable-{latin,latin-ext}`   | Variable font, covers weights 400–500 |

Google Fonts serves the same variable file for each requested weight, so
Manrope and Newsreader are stored once and declared with a weight range
rather than duplicated per weight.

All three are licensed under the SIL Open Font License 1.1. The licenses are
bundled alongside the fonts as `OFL-DM-Mono.txt`, `OFL-Manrope.txt`, and
`OFL-Newsreader.txt`.

To refresh, request the CSS from `https://fonts.googleapis.com/css2` with a
browser User-Agent (otherwise the response uses formats other than woff2),
download the files it points at, and regenerate the `@font-face` blocks at
the top of `src/styles.css`.
