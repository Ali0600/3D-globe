#!/usr/bin/env bash
# Fetch and downscale the Earth textures used by the Three.js prototype.
# Public-domain NASA imagery (Blue Marble color + GEBCO topo/bathy elevation).
# Idempotent: re-running overwrites the files. Requires curl and sips (macOS).
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/public/textures"
mkdir -p "$DIR"

COLOR_URL="https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/73909/world.topo.bathy.200412.3x5400x2700.jpg"
HEIGHT_URL="https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/73934/gebco_08_rev_elev_21600x10800.png"
# NASA Black Marble / VIIRS 2012 city lights — used for the night-side glow.
NIGHT_URL="https://eoimages.gsfc.nasa.gov/images/imagerecords/79000/79765/dnb_land_ocean_ice.2012.3600x1800.jpg"

echo "→ Downloading color map…"
curl -fsL --retry 2 -o "$DIR/earth_color.jpg" "$COLOR_URL"

echo "→ Downloading elevation/bathymetry height map (~18 MB)…"
curl -fsL --retry 2 -o "$DIR/earth_height.png" "$HEIGHT_URL"

echo "→ Downloading city-lights (night) map…"
curl -fsL --retry 2 -o "$DIR/earth_night.jpg" "$NIGHT_URL"

# Downscale to web-friendly sizes (the raw height map is 21600x10800).
if command -v sips >/dev/null 2>&1; then
  echo "→ Resizing (sips)…"
  sips -z 2048 4096 "$DIR/earth_color.jpg"  >/dev/null   # 4096x2048
  sips -z 1024 2048 "$DIR/earth_height.png" >/dev/null   # 2048x1024
  sips -z 1024 2048 "$DIR/earth_night.jpg"  >/dev/null   # 2048x1024
elif command -v magick >/dev/null 2>&1; then
  echo "→ Resizing (ImageMagick)…"
  magick "$DIR/earth_color.jpg"  -resize 4096x2048\! "$DIR/earth_color.jpg"
  magick "$DIR/earth_height.png" -resize 2048x1024\! "$DIR/earth_height.png"
  magick "$DIR/earth_night.jpg"  -resize 2048x1024\! "$DIR/earth_night.jpg"
else
  echo "⚠ Neither sips nor ImageMagick found — leaving full-resolution images."
  echo "  The 21600x10800 height map is too large for a browser texture; please resize it."
fi

echo "✓ Done. Textures in public/textures/"
ls -lh "$DIR"
