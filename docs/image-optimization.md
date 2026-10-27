# Image optimization

Stored images are optimized for the site. Social platforms get the original upload.

## Formats

| Source | Stored as | Why |
| --- | --- | --- |
| PNG | AVIF, falling back to WebP | Smaller display copy, keeps alpha. |
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
available or all encodes fail, the original buffer is stored unchanged and the result reports
`optimized: false` — a post never fails because of image optimization. The workflow installs
ImageMagick via `apt-get`. Successful exit status alone is insufficient: some builds can return
PNG data when asked for AVIF. The optimizer checks the actual encoded format and width before
reporting success. If AVIF fails validation, it tries WebP; if that also fails, it keeps the
original bytes and extension. Attachment formats are detected from their bytes before consulting
HTTP headers. GIFs remain untouched.

`gen-rss.js` passes the enclosure MIME type explicitly from `contentTypeFromPath`; the `rss`
package's own extension table does not know AVIF and emits `type="false"` when left to infer.

## Bulk optimization

```sh
./assets/scripts/optimize-images.sh [dir]
```

Defaults to `assets/img/content`. Rewrites JPG, JPEG, PNG, and WebP files in place at the
settings above; skips AVIF and GIF files. Four batches are processed in parallel.

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

An October 2026 check found 14 files with `.avif` extensions that contained PNG data, including
`20261026T0921`. Re-encoding them as genuine AVIF reduced their combined size from 9,031,750 to
699,149 bytes. `20261026T0921` alone fell from 1,146,456 to 129,803 bytes at the same dimensions.
