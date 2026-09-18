# Image optimization

Stored images are optimized for the site. Social platforms get the original upload.

## Formats

| Source | Stored as | Why |
| --- | --- | --- |
| PNG | AVIF | ~93% smaller on screenshots, keeps alpha. |
| JPG / JPEG | WebP | ~45% smaller than JPEG at q75; matches AVIF on photos and encodes far faster. |
| WebP | WebP | Re-encoded at the same settings. |
| GIF | GIF, untouched | Animation must survive. |

Every stored image is resized to a maximum width of 900px (height follows the aspect ratio),
stripped of metadata, and encoded at quality 75. Images narrower than 900px keep their dimensions.

## New posts

`assets/scripts/create-post-from-issue.js` downloads the issue attachment, then calls
`optimizeImage` from `lib/optimize-image.js` before writing the asset. The post record gets:

- `displayImage` / `image` — the optimized file stored in `assets/img/content/`.
- `socialImage` — the original attachment URL, set only when optimization actually changed the file.

`lib/publisher-common.js` (`fetchImageBlob`) and `lib/threads-publisher.js` prefer `socialImage`, so
Mastodon, Bluesky, and Threads receive the original JPG/PNG/GIF rather than the AVIF or WebP copy.
Bluesky's MIME lookup reads `socialImage` first for the same reason. If the original URL cannot be
fetched, publishing falls back to the stored optimized file.

`optimizeImage` shells out to ImageMagick (`magick`, falling back to `convert`). If no binary is
available or the encode fails, the original buffer is stored unchanged and the result reports
`optimized: false` — a post never fails because of image optimization. The workflow installs
ImageMagick via `apt-get`. The ubuntu-24.04 runner's ImageMagick 6 has a working AVIF delegate,
confirmed by post 20260918T1034 (PNG upload stored as AVIF). If a future runner image drops it, PNG
posts land as PNG with `optimized=false` and the bulk script below converts them on the next run.

`gen-rss.js` passes the enclosure MIME type explicitly from `contentTypeFromPath`; the `rss`
package's own extension table does not know AVIF and emits `type="false"` when left to infer.

## Bulk optimization

```sh
./assets/scripts/optimize-images.sh [dir]
```

Defaults to `assets/img/content`. Rewrites JPG, JPEG, PNG, WebP, and AVIF files in place at the
settings above; skips GIFs. Four files are processed in parallel.

The script does not convert PNG to AVIF — it only re-encodes in place. The one-time PNG conversion
was run separately; repeat it with:

```sh
find assets/img/content -iname '*.png' -print0 |
  xargs -0 -P 4 -n 1 -I{} sh -c 'magick "$1" -strip -quality 75 "${1%.png}.avif" && rm "$1"' _ {}
```

Then rewrite the references in `data.json` and regenerate the feed:

```sh
sed -i '' -E 's#(img/content/[0-9T]+)\.png#\1.avif#g' data.json
npm run rss
```

## Dimension parsing

`lib/image-size.js` parses PNG, GIF, JPEG, WebP, and AVIF headers. `gen-index.js` calls it for every
post at build time, so any new stored format needs a parser there and a MIME entry in
`lib/publisher-common.js` and `lib/bluesky-publisher.js`.

## Results

The September 2026 pass over `assets/img/content`:

- 446 JPG/PNG/WebP files re-encoded and resized: 71.7MB to 50.0MB.
- 75 PNGs converted to AVIF: 27.1MB to 2.6MB.
- 285 GIFs left untouched: 241.9MB, still the bulk of the directory.
