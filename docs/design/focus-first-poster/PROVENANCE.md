# Provenance of this folder

This note is not part of the design handoff. It records where the other files
in this folder came from, so reviewers know what is original and what is not.

The Focus-first poster handoff was supplied as a published Claude Design
artifact (a self-unpacking "Bundled Page"), not as a folder of source files.
The three `.dc.html` files here were decoded from that bundle byte for byte:

| File | Bundle entry |
| --- | --- |
| `Focus 01 One Bounty at a Time.dc.html` | the bundle's page template (the canvas). Its name comes from the link to it in the companion "Focus-first, both sides" canvas. |
| `PosterBlock.dc.html` | `./PosterBlock.dc.html` |
| `PosterPhone.dc.html` | `./PosterPhone.dc.html` |

What that means for the files the brief mentions:

- **`screens.dc.js`**: not a separate file in the bundle. The screen data
  (every screen's blocks, `spec.backend` tags and `verify` fields) is the
  `<script type="text/x-dc">` class at the end of the canvas page.
- **`poster-palette.css`**: not a separate file. The palette is the `<style>`
  block at the top of `PosterPhone.dc.html`: `:root` holds the light values
  and `[data-pt="dark"]` the dark ones. The app keeps the handoff's colour
  *roles* (`lib/themes/poster-palette.ts`) but maps each one onto the app's
  existing light and dark colours; the handoff's hex values were not adopted.
- **`README.md`**: not present in the bundle.
- **"Focus 02 System and Handoff"** (diagrams, components, the featured-job
  priority diagram): linked from the canvas but not included in the bundle.

In the canvas page, the bundler replaced script and font URLs with internal
asset ids and inlined the design-system stylesheets, so the page is a
reference to read rather than something that runs on its own. Vendor assets
from the bundle (React, fonts, icon CSS, the design-system script) were left
out on purpose.

The hunter screens come from the companion artifact "Focus-first, both
sides", whose block file is a superset of `PosterBlock.dc.html` (it adds side
labels, `label`, `tcard` and `arow` blocks and changes nothing else).
