# Social publishing

Current Status publishes each new image status to Mastodon, Bluesky, and Threads.

## How publishing works

1. Opening a status-post issue triggers `.github/workflows/create-status-post-pr.yml`.
2. The workflow creates and auto-merges a pull request containing the new `data.json` entry and image.
3. Netlify builds and deploys the production site.
4. The local Netlify build plugin calls `/.netlify/functions/publish-social` after a successful
   production deploy, but only when `data.json` changed.
5. Each social publisher claims the post in its own Netlify Blob store before calling the external
   API. A recorded or currently claimed post is not published again.

Failures are isolated by service. For example, a Threads failure does not undo a successful Mastodon
or Bluesky post. The function returns a partial-failure result and the deploy log identifies the
failed service.

## Environment variables

Copy `.env-dist` to the ignored `.env` file for local commands. Never commit real credentials.

| Variable | Purpose |
| --- | --- |
| `MASTODON_URL` | Mastodon instance URL. |
| `MASTODON_TOKEN` | Mastodon application token. |
| `BLUESKY_IDENTIFIER` | Bluesky handle or DID. |
| `BLUESKY_APP_PASSWORD` | Bluesky app password. |
| `BLUESKY_SERVICE` | Bluesky API origin; normally `https://bsky.social`. |
| `THREADS_ACCESS_TOKEN` | Long-lived Threads user access token. |
| `THREADS_API_BASE` | Threads API origin; normally `https://graph.threads.net`. |
| `SOURCE_BASE_URL` | Optional public site/deploy origin used to resolve status image URLs locally. |
| `PUBLISH_SECRET` | Shared secret protecting the Netlify publish function. |
| `NETLIFY_SITE_ID` | Site ID used by local Blob-backed maintenance commands. |
| `NETLIFY_AUTH_TOKEN` | Netlify token used by local Blob-backed maintenance commands. |

Configure the runtime values in the Netlify site's environment variables as well as `.env`.

## Set up Threads

The app only publishes to its owner/tester account, so it does not need advanced access for other
public users.

1. Create a Meta app with the **Threads API** use case in the
   [Meta App Dashboard](https://developers.facebook.com/apps/).
2. Under **Use cases → Access the Threads API → Customize**, add these permissions:
   - `threads_basic`
   - `threads_content_publish`
3. Under **Settings**, configure the exact OAuth redirect URI used by Current Status:

   ```text
   https://current-status.com
   ```

   Meta's redirect field is a list input: click its dropdown suggestion or press Enter so the URL
   becomes a saved entry. The Threads dashboard also requires uninstall and delete callback URLs;
   use `https://current-status.com` for this private development app. A public multi-user app would
   require real callback handlers.
4. Under **App roles → Roles**, add the target profile as a **Threads Tester**. In that Threads
   profile, accept the invitation under **Settings → Account → Website permissions → Invites**.
5. Open the authorization window, substituting the Threads-specific app ID. The `redirect_uri` must
   match the saved value exactly, including the absence of a trailing slash:

   ```text
   https://threads.net/oauth/authorize?client_id=THREADS_APP_ID&redirect_uri=https%3A%2F%2Fcurrent-status.com&scope=threads_basic%2Cthreads_content_publish&response_type=code
   ```

6. After approval, copy only the `code` query value from the redirect URL; exclude the trailing `#_`.
   Exchange the single-use code for a short-lived token within one hour:

   ```sh
   curl --request POST 'https://graph.threads.net/oauth/access_token' \
     --form-string "client_id=$THREADS_APP_ID" \
     --form-string "client_secret=$THREADS_APP_SECRET" \
     --form-string 'grant_type=authorization_code' \
     --form-string 'redirect_uri=https://current-status.com' \
     --form-string "code=$THREADS_AUTHORIZATION_CODE"
   ```

7. Exchange the returned short-lived token for a long-lived token:

   ```sh
   curl --get 'https://graph.threads.net/access_token' \
     --data-urlencode 'grant_type=th_exchange_token' \
     --data-urlencode "client_secret=$THREADS_APP_SECRET" \
     --data-urlencode "access_token=$THREADS_SHORT_LIVED_TOKEN"
   ```

8. Put the returned token in local `.env` as `THREADS_ACCESS_TOKEN`, then add the same variable to
   Netlify's production/Functions environment. The app ID and app secret are only needed during
   authorization and are not runtime settings.
9. Confirm the saved token identifies the intended profile with a read-only `GET /me` request or
   Meta's Access Token Debugger.

Never paste authorization codes, access tokens, app secrets, full redirected URLs, or unredacted Meta
OAuth errors into chat, issues, logs, or shell history. Meta error messages can echo a submitted
secret. If exposure occurs, rotate the Threads app secret immediately and start with a fresh
authorization code.

Meta's current [Threads authorization documentation](https://www.postman.com/meta/threads/documentation/dht3nzz/threads-api?entity=request-34203612-13ebe336-0176-4d4e-ace7-5b32ad56f327)
is the source of truth if the dashboard or token flow changes.

## Test locally

Run mocked tests before making a real post:

```sh
npm run build
npm test
```

To make one real Threads post from the first entry in `data.json`:

```sh
npm run publish:threads
```

This command intentionally bypasses the Netlify Blob deduplication store. It creates a real public
post every time it runs. Verify the text, image, and alt text, then deliberately keep or delete the
test post in the Threads UI.

Threads fetches the image itself, so `SOURCE_BASE_URL` must be publicly reachable. The command
defaults to `https://current-status.com`; localhost and local file paths will not work. The deployed
URL must already contain the image referenced by the top `data.json` post.

To publish all three networks directly, use `npm run publish:local`. This also creates real public
posts and bypasses Blob deduplication.

## Production rollout

Deploying publisher code without a `data.json` change does not create a social post. The first later
production deploy that includes a new status publishes that status once to all three services. Past
statuses are not backfilled to Threads.

The production Threads flow:

1. Creates an `IMAGE` media container using the deployed image URL, `current status:` text, and the
   status image's alt description.
2. Polls the container until Meta reports `FINISHED`; `ERROR`, `EXPIRED`, and polling timeouts fail
   safely before publication.
3. Publishes that container.
4. Looks up the post permalink when possible.
5. Stores the container ID, post ID, permalink, commit, and timestamp in the `threads-posts` Netlify
   Blob store.

If permalink lookup fails after publication, the post is still recorded using its post ID so a retry
cannot create a duplicate.

## Renew the Threads token

Long-lived Threads tokens expire after about 60 days. Refresh the token while it is still valid, on a
recurring reminder set comfortably before expiration:

```sh
curl --get 'https://graph.threads.net/refresh_access_token' \
  --data-urlencode 'grant_type=th_refresh_token' \
  --data-urlencode "access_token=$THREADS_ACCESS_TOKEN"
```

Replace `THREADS_ACCESS_TOKEN` in `.env` and Netlify if Meta returns a new token. Verify the renewed
token and its permissions with the Access Token Debugger. Do not wait until the old token has expired;
an expired token must be authorized again.

## Troubleshooting

- `missing_threads_environment`: set `THREADS_ACCESS_TOKEN` in the environment running the command or
  Netlify function.
- `Invalid image URL`: confirm the resolved image is available over public HTTPS without credentials
  and that the production deploy already contains it.
- Permission errors: verify `threads_basic` and `threads_content_publish`, the tester invitation, app,
  account, and token in Meta's debugger.
- An isolated Threads failure: inspect the Netlify function/build log. Mastodon and Bluesky may still
  have succeeded.
- A post remains `publishing`: do not remove its Blob claim until checking Threads for a live post.
  Claims are deliberately retained after a confirmed post if recording fails, preventing duplicates.
- Missing permalink in logs: use the recorded Threads post ID. A failed permalink lookup does not mean
  publication failed.
