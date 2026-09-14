# Running Hack This Building

The public app is at **https://www.hackthisbuilding.com**. The bare domain forwards there. The React app is deployed to Cloudflare Pages; `/api/*` is forwarded through a service binding to the `hackthisbuilding` Worker. A single Durable Object (`public-show-v1`) owns the persisted public queue. The server uses OpenRouter when its secret is configured, and Workers AI when that secret is absent.

This application is an interactive **in-browser simulator**. The current source renders actual Three.js building geometry with 153 animated windows, following the provided nighttime simulator reference. Its windows use the same 17-row × 9-column RGB frames as the deterministic animation engine. A supervised local runner bridges those frames to the assigned organizer simulator instance. Actual live colored frames have been verified through its WebSocket; physical-building delivery is still unverified. See [acceptance results](acceptance-results.md) for the distinction between local checks and public deployment.

The Red Sox/Weather buttons, Pong and Mario activities, 30-second turns, and four-color idle screensaver were published from commit bdad26a on September 13, 2026 (EDT). The public API and matching frontend asset were verified. The bridge is configured and connected to the assigned organizer instance through the operator’s Mac. Keep that host powered and online.

The 3D module loads separately, with the 2D canvas retained during loading or WebGL failure. Pointer, touch, and keyboard camera controls change the viewpoint without changing the approved clip or shared clock. Arrow keys orbit, +/− zoom, and Home resets the view. Use the camera-view controls for preset framing.

## Develop

Use Node 22.12 or newer. The deployed application lives in `simulator/`; the team's separate proof of concept remains at the repository root.

```sh
cd simulator
npm ci
npm run build
npm run preview
```

For frontend hot reload, also run `npm run dev`; Vite forwards API requests to port 8787. Curated examples work without an AI connection. AI availability is explicit; an unavailable model never silently becomes a canned animation.

## AI provider and image previews

Configure `OPENROUTER_API_KEY` as a Worker secret with `npx wrangler secret put OPENROUTER_API_KEY`. For local development, keep the value in the ignored `simulator/.dev.vars` file. Never include it in frontend variables, checked-in files, or browser requests.

## Pydantic safety validator

Run `validator/app.py` as a private Python service with `OPENROUTER_API_KEY` and a strong `VALIDATOR_TOKEN`. Configure the Worker with `VALIDATOR_URL` and the matching `VALIDATOR_TOKEN` secret. The validator uses strict Pydantic models, forbids extra fields, rejects political or strobing content, marks adversarial prompts, and retries invalid or transient moderation responses up to three times. Without `VALIDATOR_URL`, the Worker uses its built-in moderation. The public deployment currently has no separate Python validator URL configured.

Python owns moderation retries: at most three model calls, each with a 20-second transport timeout and backoffs of 250ms and 500ms. The Worker sends `/moderate` once with a 65-second deadline, leaving room for those attempts and avoiding duplicate nested moderation requests. Keep any service proxy timeout above that Worker deadline. A Python transport timeout is not a hard total execution limit; the Worker's deadline remains the caller's bound, and cancellation does not guarantee the server has stopped its current model request.

`/validate-animation` performs no model call. The Worker permits at most three HTTP attempts with a five-second timeout each and the same backoff schedule; a schema rejection (HTTP 422) is returned immediately without retrying that request. Generated-output retries remain separately bounded at three candidate generations. Validation errors omit raw inputs, documentation URLs, and exception context so field-validator failures remain JSON-serializable and do not expose rejected content.

When the OpenRouter key is present:

- Text moderation and ordinary motion prompts use `google/gemini-2.5-flash` through OpenRouter. Motion prompts still produce constrained, validated shape instructions.
- Prompts mentioning a logo, icon, emblem, image, picture, photo, portrait, or Sundai use the image API with `google/gemini-2.5-flash-image`. Sundai requests include the bundled logo reference.
- Each image request passes text moderation, PNG validation and conversion to the 17 × 9 window grid, then a vision safety check before an approved preview is returned. Benign logos and sports marks are allowed; they do not bypass moderation.
- The image provider call has a 65-second timeout, with separate time allowed for surrounding checks. Provider failures return an explicit error; billable submissions are not automatically retried.
- The application persists the resulting 153 RGB window values and approved scene metadata. It does not retain or serve the full generated image.

When the key is absent, the Workers AI binding handles text moderation and shape generation; the OpenRouter image path is unavailable. An invalid or exhausted OpenRouter key produces an error instead of silently switching providers. `/api/health` identifies the configured provider and image-generation availability without exposing secrets.

The bundled Sundai reference comes from the [official club logo](https://www.sundai.club/images/logos/sundai_logo_dark_horizontal.svg). The image prompt uses its cone emblem because the full wordmark cannot be legible across nine columns. Provider integration follows the [OpenRouter Image API](https://openrouter.ai/docs/guides/overview/multimodal/image-generation).

## Red Sox and Weather previews

**Red Sox score** calls `POST /api/red-sox` to create a private score preview. It selects active play first, then the latest completed Boston result when no active game exists. Warmup, suspended, postponed, cancelled, and scheduled games cannot substitute a placeholder score. A delayed active game retains its score and label; resumed games use the actual resumption date. One bounded history fallback covers the current and previous season for off days and the offseason. Boston appears red/top, its opponent white/bottom, with date, status and capture time in the preview description.

Score responses are cached across visitors for 30 seconds while live or five minutes when final. Each lookup has a nine-second deadline, at most two fixed MLB requests, and bounded response bodies. Missing or unavailable data returns an error. The five-minute preview expiry and immutable approved pixels preserve the normal submit contract; an accepted turn does not become a continuously updating scoreboard. See [Red Sox API research](research-redsox-api.md) for actual response evidence, detailed MLB status handling, and usage considerations.

**Weather** calls `POST /api/weather` for current Fahrenheit conditions near the Green Building. It is separate from the existing **Make it rain** creative preset. The primary is a recent NWS observation from nearby Boston Logan (KBOS); one Open-Meteo fallback supplies explicitly labeled modeled Cambridge conditions. The fixed icon distinguishes clear day/night, partly cloudy, overcast, rain, snow, fog, thunderstorm, and mixed/freezing precipitation. The source condition name and observation/model-valid timestamp appear beside the preview. No condition is hardcoded from a request's wording.

Weather has a shared five-minute cache, a three-second NWS budget within one nine-second overall deadline, a 64 KiB body limit, and no provider retries. NWS observations older than 75 minutes and model conditions older than 45 minutes are rejected; cache reuse cannot extend those age limits. Temperatures must be finite and correctly identified as Celsius or Fahrenheit. Both-source failure creates no preview. Weather previews expire after five minutes and remain fixed during their public turn. See [Weather API research](research-weather-api.md) for the provider comparison, attribution, and verified live payloads.

Neither data button needs an AI request or a new provider key in this implementation. Open-Meteo's free endpoint is for noncommercial use and requires attribution; use an appropriate paid arrangement or change the fallback if the deployment becomes commercial. Keep provider links visible with the weather preview.

## Validate and deploy

```sh
npm run typecheck
npm test
npm run build
npx wrangler deploy
npx wrangler pages deploy --cwd pages --project-name hackthisbuilding --branch main
```

Run the commands above from `simulator/`. `npm run deploy` performs these steps. Sign in with `npx wrangler login` to an account that owns both projects. The Worker must be deployed before Pages because Pages binds to it. OpenRouter usage draws on the configured key's account; Workers AI usage follows the deploying Cloudflare account's plan. Application limits bound preview requests.

After publishing, verify the public `/api/health` endpoint, the loaded 3D scene and camera controls, and a preview-to-queue interaction on the custom domain. A successful local build or upload alone does not establish that visitors have received the latest version.

GitHub Actions runs checks on main and pull requests. **Git pushes do not automatically deploy this initial release.** Automatic deployment requires a repo administrator to add a scoped Cloudflare API token (Workers Scripts Edit, account-level Workers AI access, and Cloudflare Pages Edit as required by the deploy commands) and account ID to a deployment workflow. Never put a developer's broad CLI OAuth token in the repository or GitHub secrets.

Runner checks are separate: install `display_runner/requirements.txt` into a Python environment, then run `python -m unittest discover -s display_runner -p 'test_*.py' -v` from the repository root with that interpreter. The tests mock HTTP and do not write to an organizer instance. The original PR findings and their reviewed commits are recorded in [Ryan PR review](review-ryan-prs-2026-09-13.md); use the final integrated source and its checks rather than treating that historical review as proof of a released version.

## Domain routing

- Porkbun DNS: `www` CNAME → `hackthisbuilding.pages.dev`, TTL 600.
- Cloudflare Pages custom domain: `www.hackthisbuilding.com`.
- Porkbun root URL forward: `https://www.hackthisbuilding.com`, temporary 302, include path, wildcard off.
- Leave email records intact. DNS stays at Porkbun; the external DNS subdomain setup avoids a nameserver transfer.

The on-page domain has four deliberate colors: `hack` gold (`#faca4c`), `this` cyan (`#69c1fa`), `building` pink (`#f779a6`), and `.com` ivory (`#f5f3e6`). These are wordmark styles, not additional hostnames or DNS records.

## Operator controls

A private `ADMIN_TOKEN` is configured for the initial deployment and saved in the deploying developer's ignored `.dev.vars` file. It is never included in frontend assets or GitHub. Use `node scripts/operator.mjs pause`, `resume`, `skip`, or `remove <submission-id>` from that checkout; other operators need the token through a private channel. To rotate it, use `npx wrangler secret put ADMIN_TOKEN` and update the local ignored value.

The script POSTs to `/api/admin` with JSON `{"action":"pause"}`, `resume`, `skip`, or `{"action":"remove","id":"…"}` and an `Authorization: Bearer …` header. Missing or incorrect tokens cannot operate the show. Pause ends the active turn and leaves waiting turns in the queue. The bridge feed returns black while paused. Resume gives the next player five seconds of notice; when the bridge is configured it also requires a fresh connected heartbeat.

Run operator actions from a trusted local shell. The bundled script targets `https://www.hackthisbuilding.com`, even when launched from a local checkout. For a localhost Worker, send the same authenticated JSON request to its own `/api/admin` endpoint with the local admin token instead of using that production-targeted script.

## Show behavior

- A prompt is at most 280 characters. Shape generation uses bounded drawing instructions; image generation stores validated window pixels. Neither executes model-generated code or fetches model-supplied image URLs.
- Preview privately, then explicitly submit that exact server-approved clip. Heart, Smile and Arrow quick picks preserve the team POC bitmap patterns from the Kalyani branch; all ten curated options work without AI generation.
- AI previews expire after 30 minutes. Server-curated examples use `expiresAt: 0` and remain available in an open page; that exemption cannot be used by AI clips.
- One pending or playing turn per session; at most 10 waiting turns; submissions are idempotent.
- FIFO determines turn order. Hearts are reactions and do not reorder it.
- Light ideas, score/weather snapshots, Pong, and Super Mario share one FIFO queue. Each new turn lasts 30 seconds; approved five-second animations loop during the light turn. The first idle admission receives at least five seconds of notice. Following turns run back to back, except a late arrival gets enough idle time to preserve that notice.
- The interface shows the number of turns ahead, an ETA, and the active countdown. There are no mandatory URL interludes; the URL remains visible on the page.
- When no turn is active, the default building screensaver scrolls hackthisbuilding.com every twelve seconds: hack gold (#FACA4C), this cyan (#69C1FA), building pink (#F779A6), and .com ivory (#F5F3E6). The 2D/3D views and organizer feed use the same server-synchronized frames. The scroll never creates a queue entry or delays a reserved turn.
- Pong uses an authoritative eight-tick-per-second server engine. Only the active owner controls the bottom paddle; everyone else watches. The browser sends at most eight updates per second and the server caps inputs at 20 per second. Stale sequence numbers cannot overwrite newer inputs.
- `POST /api/pong/join` accepts `{requestId}` and uses the same admission and retry rules as light submission. `POST /api/pong/input` accepts `{id,x,sequence}` with paddle position 0–6. `GET /api/state` includes the active game snapshot.
- **Super Mario** is the final activity button. The original 9 × 17 platformer includes left/right movement, jumping, platforms, pipes, gaps, coins, hazards, three lives, and a finish flag. Score, coins, lives, and progress are visible. Win/game-over state remains until the turn ends.
- `POST /api/mario/join` accepts `{requestId}`. `POST /api/mario/input` accepts `{id,direction,jump,sequence}` with direction −1, 0 or 1 and a boolean jump. Only the active owner can control it. Inputs are sent at most eight times per second; a jump press sends one edge, and directions expire after 400 ms without updates. Keyboard shortcuts are scoped to the focused control panel so they do not take over camera or text-editor input.
- Deployment migration preserves an active legacy turn’s end; queued legacy clips become 30-second turns.
- The server owns the clock and queue. Refreshing, reconnecting, or visiting from another browser preserves the public show.
- Public queue metadata contains generated titles and approved interpretations, not raw user prompts or session identifiers.

## Configure the organizer simulator bridge

The bridge source is in [`display_runner/`](../display_runner/README.md). Only start it with the organizer-issued instance assigned to this project. The user supplied their assigned instance, which was configured privately on September 13, 2026. The bridge targets the organizer simulator API and does not itself establish a physical MIT-building connection.

1. Choose a strong private `DISPLAY_RUNNER_TOKEN`. Configure it as a Worker secret with `npx wrangler secret put DISPLAY_RUNNER_TOKEN` from `simulator/`. For a local Worker, put the matching value in the ignored `simulator/.dev.vars` file. Adding the token activates heartbeat enforcement; without a connected runner, the show pauses.
2. In `display_runner/`, create a virtual environment, install `requirements.txt`, and copy `.env.example` to the ignored `.env` file. Keep it local and private.
3. Set `DISPLAY_SOURCE_URL` to the same Worker-facing app you configured: `http://127.0.0.1:8787` for a local stack or `https://www.hackthisbuilding.com` for the deployed app. Set the identical `DISPLAY_RUNNER_TOKEN`, the authorized `GREEN_BUILDING_INSTANCE` in its server-issued adjective-animal format, and the organizer-approved `GREEN_BUILDING_API` base. The checked adapter defaults that base to `https://sundai.willsarg.com/api`.
4. Keep the runner computer's clock synchronized and run `.venv/bin/python runner.py` from `display_runner/`. Run one authorized host per instance. Its local lock prevents duplicates on one machine, not competing hosts.
5. After the target API accepts frames, the Worker reports a fresh connection, and the operator verifies recovered output, use the authenticated operator action to resume. Reconnecting the runner alone intentionally leaves the show paused.

The runner authenticates both `GET /api/display/frame` and `POST /api/display/status` with the shared bearer token. The feed returns the exact current frame, its generation timestamp, display identity, sequence, and static/dynamic classification. The runner rejects malformed dimensions/channels, frames older than 750 ms, and frames more than 250 ms in the future. It sends exactly 459 row-major RGB bytes to `/api/i/{instance}/frame`, waiting for HTTP 204 before recording API acceptance. Persistent HTTP connections avoid a new TLS handshake for every frame. Requests have a two-second socket timeout; response bodies are bounded and drained before reuse. All sends, including recovery frames, are limited to 30 FPS; slower HTTP responses reduce frame rate. Live observation measured about 8.5 received frames per second.

The [organizer API reference at commit f7763a5](https://github.com/willsarg/sundai-greenbuilding-sim/blob/f7763a55e8de0537e64c0df418bf5a0a08257b73/README.md#api-reference) and [instance implementation](https://github.com/willsarg/sundai-greenbuilding-sim/blob/f7763a55e8de0537e64c0df418bf5a0a08257b73/poc/src/instance.js) verify the binary format, HTTP 204 response, and 40-POST-per-second instance limit. Frames are queued for a 33 ms update tick and newer pending frames can replace older ones. **HTTP 204 is queued acceptance, not proof that a viewer or physical window displayed the frame.** Immediate readback can therefore still show the preceding frame.

Static frames are deduplicated only after a successful POST, then re-sent about once per second for renewed acceptance before reporting continued connection. This refresh also preserves live mode: the organizer's stored clip resumes two seconds after the last live frame, as documented in its [reference](https://github.com/willsarg/sundai-greenbuilding-sim/blob/f7763a55e8de0537e64c0df418bf5a0a08257b73/README.md#clip--upload-an-animation-once-it-loops-forever) and [Python client](https://github.com/willsarg/sundai-greenbuilding-sim/blob/f7763a55e8de0537e64c0df418bf5a0a08257b73/poc/python/gbsim/web.py). Source, target, or status failures attempt black fallback and report disconnected; five consecutive failures stop the runner. If the target cannot accept the fallback, the organizer's local recovery procedure remains necessary. An uploaded organizer clip can resume when live sending stops.

The Worker treats a heartbeat age of 3.5 seconds as disconnected and pauses before scheduler catch-up can consume waiting turns. Waiting entries remain; interrupted play is removed without being marked successfully completed or automatically replayed. A later connected heartbeat does not resume dispatch. Verify this recovery sequence with the actual instance before relying on it during an event.

## Physical installation acceptance

After the organizer simulator passes end-to-end checks, obtain the approved hardware transport, verify row orientation and color calibration, check on-site legibility and brightness, and establish a local disconnect fallback. Keep the interface labeled simulator until the physical path is actually verified. Current automated connection tests use mocked acknowledgments and do not prove organizer or building access.
