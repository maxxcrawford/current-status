#!/bin/bash
# Resize to max 900px wide, 75% quality, in place. GIFs untouched (animation).
set -euo pipefail
dir="${1:-assets/img/content}"
before=$(du -sk "$dir" | cut -f1)
find "$dir" -type f \( -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.png' -o -iname '*.webp' \) -print0 |
  xargs -0 -P 4 -n 20 magick mogrify -strip -resize '900>' -quality 75
after=$(du -sk "$dir" | cut -f1)
echo "$dir: $((before/1024))MB -> $((after/1024))MB"
