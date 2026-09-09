# Favicons

`favicon-source-96.png` (96×96) is the master. There is no SVG or larger raster
of this mark — `assets/shapes/galaxy_arms.svg` is a *different*, far more
intricate drawing (six hairline spirals at 0.43% stroke width) and is not a
usable icon source. Do not regenerate the favicon from it.

The black background is intentional, not a missing alpha channel. The mark is
white, so an opaque tile is what keeps it visible in a light tab bar, and it is
also what `apple-touch-icon` requires if one is ever added.

## Regenerating

```bash
cd icons
magick favicon-source-96.png -filter Lanczos -resize 16x16 -level 0%,62% favicon-16.png
magick favicon-source-96.png -filter Lanczos -resize 32x32 -level 0%,80% favicon-32.png
magick favicon-source-96.png -filter Lanczos -resize 48x48 favicon-48.png
magick favicon-16.png favicon-32.png favicon-48.png ../favicon.ico
```

Two notes on the recipe:

- Use Lanczos. `sips` uses a weaker resampler that turns the arms into a gray
  smudge at 16px; the source is fine, the resampler was not.
- `-level` compensates for tonal loss when white strokes are averaged against
  black during downsampling. 48px is an exact ÷2 with no loss, so it gets none.

## Sizes

96px caps the set at 16/32/48. `apple-touch-icon` (180) and PWA install icons
(192/512) would need upscaling and would look soft, so they are deliberately
not provided. If those are ever needed, redraw the mark as an SVG — it is six
tapered arcs, which is tractable.
