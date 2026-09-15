# Paper room

The current interface uses an original scene built in `src/PaperScene.tsx` and `src/styles.css`: a dark aperture, receding floor, suspended paper fragments, and a foreground sheet containing the next scheduled reading. Fragments use titles from the paper pool. Perspective, shadows, folds, an SVG noise texture, and pointer/scroll parallax are generated in the browser; there are no external artwork requests.

The motion toggle stops the scene's animation and parallax. Reduced-motion preferences disable these automatically. The previous island image is retained below for provenance but is no longer included in the website bundle.

## Previous reading island

- Previous asset: `src/assets/reading-island.png` (unused).
- Created with the built-in imagegen tool for this project; no external image hosting.
- Original size: 1536 × 1024.
- Direction: surreal matte painting, analog texture, open books and impossible landscapes, informed by the requested Melchior Leroux reference. This is original generated artwork, not a reproduction of a portfolio piece.
- Typeface assets: DM Sans and Instrument Serif, bundled locally via Fontsource. Licenses are included with their installed packages.

Full generation prompt:

> Use case: stylized-concept. Asset type: wide hero artwork for an experimental academic reading group website. Create a cinematic surreal matte-painting landscape, a tranquil impossible scene: an enormous open ivory book floats just above a vivid lime-green grassy island, its pages gently bending into sculptural wings. The island sits in a still cobalt blue sea, distant soft green hills, vast saturated cerulean sky with a few fluffy white clouds. A small perfect chrome sphere hangs in the air to the right of the book. Inspired by analog airbrush album artwork and dreamlike 1990s digital landscapes, tactile film grain, luminous midday light, beautiful uncanny realism. Landscape 3:2, book and island centered in lower two-thirds with lots of blue sky at top. Bold simple composition, strong silhouettes, no text, no typography, no logos, no watermark.
