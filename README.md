# Current Status

The site is generated from `data.json` and published through Netlify. Status posts can also be
published to Mastodon, Bluesky, and Threads after a successful production deploy.

See [Social publishing](docs/social-publishing.md) for setup, local testing, token renewal, and
troubleshooting.

See [Image optimization](docs/image-optimization.md) for stored image formats, the bulk optimize
script, and why social platforms receive the original upload.

The feed renders 30 posts per page and loads older batches automatically while scrolling.
Static links at `/page/2/`, `/page/3/`, and so on also work without JavaScript. The displayed
post count includes the full archive, and returning from a post restores loaded batches
and the reading position when session storage is available.

Run `npm run build && npm test` for the build and publishing tests. To run browser tests,
install Chromium once with `npx playwright install chromium`, then run `npm run test:browser`.
To use an installed Google Chrome instead, run `PLAYWRIGHT_CHANNEL=chrome npm run test:browser`.

The build compiles Tailwind and embeds the site CSS in each HTML page to avoid render-blocking
stylesheet requests. Tailwind 4's CLI scans the generated HTML using the sources declared in
`assets/tailwind.css`. Work Sans is served locally from `assets/fonts/` under its included OFL
license. Icons use the six-icon Font Awesome SVG kit, loaded with `defer`.
