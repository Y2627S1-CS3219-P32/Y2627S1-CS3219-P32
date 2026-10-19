<!-- AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-19.
Scope: Build instructions for the service architecture teaching guide. Author review: Pending. -->

# Building `guide.pdf` (and `guide-detailed.pdf`)

`guide.tex` (the 4-page canonical guide) and `guide-detailed.tex` (the original 33-page
guide) are each a single self-contained LaTeX file, built the same way. All diagrams are drawn inline with
TikZ, so there are no image files, external figure tools, or bibliography steps.

## Requirements

- A TeX distribution with `pdflatex` and `latexmk` (TeX Live or TinyTeX). The committed
  PDF was built with pdfTeX 3.141592653-2.6-1.40.29 (TeX Live 2026) and Latexmk 4.88.
- LaTeX packages: `geometry`, `fontenc`, `lmodern`, `microtype`, `xcolor`, `tikz`/`pgf`
  (libraries `arrows.meta`, `positioning`, `calc`; the detailed guide also uses `fit`,
  `backgrounds`), `enumitem`, `booktabs`, `titlesec`, `hyperref`, `url`; the detailed
  guide also needs `listings`, `fancyhdr`, `framed`.

On TinyTeX, any missing package can be installed with `tlmgr install <name>`, for
example `tlmgr install framed titlesec enumitem`.

## Build

From this folder:

```sh
latexmk -pdf -interaction=nonstopmode -halt-on-error guide.tex
latexmk -c guide.tex      # remove .aux/.log/.out/.fls/.fdb_latexmk; keeps guide.pdf
# same two commands with guide-detailed.tex for the 33-page version
```

Without latexmk, run `pdflatex` twice (three times for the detailed guide, which has a
table of contents).

A clean build should report no `Overfull \hbox` warnings
(`grep -c Overfull guide.log` prints `0` before cleaning).

## Optional visual check

This is how the committed PDFs were checked: every page rendered to PNG and inspected,
plus contact sheets. It needs Python with PyMuPDF and Pillow, and is not required for
building. `guide.pdf` must stay at four pages or fewer:

```python
import pymupdf
doc = pymupdf.open("guide.pdf")
for i, page in enumerate(doc, 1):
    page.get_pixmap(dpi=110).save(f"/tmp/guide-p{i:02d}.png")
print(doc.page_count, "pages")
assert doc.page_count <= 4
```

## Editing notes

- Inline identifiers use `\code{...}`, which typesets with the `url` package so that long
  names can break at `-`, `_`, `.`, `:` and `=`. Characters such as `$`, `{`, `}`, `%`
  and `#` cannot be used inside it; use `\texttt{...}` with escapes instead.
- The short guide has a hard limit of four pages; after any edit, rebuild and re-run the
  page-count assertion and look at every page.
- Detailed guide: code listings are wrapped in a `minipage` so they never split across
  pages, and source line numbers are cited only in its Appendix B and in `CLAIM_MAP.md`.
  If the code changes, update both, the pinned commit, and the short guide's footnote.
