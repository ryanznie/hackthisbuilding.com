# Running Hack This Building

The public app is at **https://www.hackthisbuilding.com**. The bare domain forwards there. The React app is deployed to Cloudflare Pages; `/api/*` is forwarded through a service binding to the `hackthisbuilding` Worker. A single Durable Object (`public-show-v1`) owns the persisted public queue. The server uses OpenRouter when its secret is configured, and Workers AI when that secret is absent.

This application is an interactive **in-browser simulator**. It does not send light commands to MIT's building or the organizer's protected simulator instance. The current source renders actual Three.js building geometry with 153 animated windows, following the provided nighttime simulator reference. Its windows use the same 17-row × 9-column RGB frames as the deterministic animation engine. See [acceptance results](acceptance-results.md) for the distinction between verified local upgrades and verified public deployment.

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

Run `validator/app.py` as a private Python service with `OPENROUTER_API_KEY` and a strong `VALIDATOR_TOKEN`. Configure the Worker with `VALIDATOR_URL` and the matching `VALIDATOR_TOKEN` secret. The validator uses strict Pydantic models, forbids extra fields, rejects political or strobing content, marks adversarial prompts, and retries invalid or transient moderation responses up to three times. Without `VALIDATOR_URL`, the legacy in-Worker moderation remains available for development compatibility.

Python owns moderation retries: at most three model calls, each with a 20-second transport timeout and backoffs of 250ms and 500ms. The Worker sends `/moderate` once with a 65-second deadline, leaving room for those attempts and avoiding duplicate nested moderation requests. Keep any service proxy timeout above that Worker deadline. A Python transport timeout is not a hard total execution limit; the Worker's deadline remains the caller's bound, and cancellation does not guarantee the server has stopped its current model request.

`/validate-animation` performs no model call. The Worker permits at most three HTTP attempts with a five-second timeout each and the same backoff schedule; a schema rejection (HTTP 422) is returned immediately without retrying that request. Generated-output retries remain separately bounded at three candidate generations. Validation errors omit raw inputs, documentation URLs, and exception context so field-validator failures remain JSON-serializable and do not expose rejected content.

When that secret is present:

- Text moderation and ordinary motion prompts use `google/gemini-2.5-flash` through OpenRouter. Motion prompts still produce constrained, validated shape instructions.
- Prompts mentioning a logo, icon, emblem, image, picture, photo, portrait, or Sundai use the image API with `google/gemini-2.5-flash-image`. Sundai requests include the bundled logo reference.
- Each image request passes text moderation, PNG validation and conversion to the 17 × 9 window grid, then a vision safety check before an approved preview is returned. Benign logos and sports marks are allowed; they do not bypass moderation.
- The image provider call has a 65-second timeout, with separate time allowed for surrounding checks. Provider failures return an explicit error; billable submissions are not automatically retried.
- The application persists the resulting 153 RGB window values and approved scene metadata. It does not retain or serve the full generated image.

When the key is absent, the Workers AI binding handles text moderation and shape generation; the OpenRouter image path is unavailable. An invalid or exhausted OpenRouter key produces an error instead of silently switching providers. `/api/health` identifies the configured provider and image-generation availability without exposing secrets.

The bundled Sundai reference comes from the [official club logo](https://www.sundai.club/images/logos/sundai_logo_dark_horizontal.svg). The image prompt uses its cone emblem because the full wordmark cannot be legible across nine columns. Provider integration follows the [OpenRouter Image API](https://openrouter.ai/docs/guides/overview/multimodal/image-generation).

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

## Domain routing

- Porkbun DNS: `www` CNAME → `hackthisbuilding.pages.dev`, TTL 600.
- Cloudflare Pages custom domain: `www.hackthisbuilding.com`.
- Porkbun root URL forward: `https://www.hackthisbuilding.com`, temporary 302, include path, wildcard off.
- Leave email records intact. DNS stays at Porkbun; the external DNS subdomain setup avoids a nameserver transfer.

## Operator controls

A private `ADMIN_TOKEN` is configured for the initial deployment and saved in the deploying developer's ignored `.dev.vars` file. It is never included in frontend assets or GitHub. Use `node scripts/operator.mjs pause`, `resume`, `skip`, or `remove <submission-id>` from that checkout; other operators need the token through a private channel. To rotate it, use `npx wrangler secret put ADMIN_TOKEN` and update the local ignored value.

The script POSTs to `/api/admin` with JSON `{"action":"pause"}`, `resume`, `skip`, or `{"action":"remove","id":"…"}` and an `Authorization: Bearer …` header. Missing or incorrect tokens cannot operate the show. Pause returns the facade to its invitation animation and leaves waiting turns in the queue.

## Show behavior

- A prompt is at most 280 characters. Shape generation uses bounded drawing instructions; image generation stores validated window pixels. Neither executes model-generated code or fetches model-supplied image URLs.
- Preview privately, then explicitly submit that exact server-approved clip.
- AI previews expire after 30 minutes. Server-curated examples use `expiresAt: 0` and remain available in an open page; that exemption cannot be used by AI clips.
- One pending or playing turn per session; at most 10 waiting turns; submissions are idempotent.
- FIFO determines turn order. Hearts are reactions and do not reorder it.
- Each clip lasts 5 seconds. The domain scrolls for two full 12-second passes between clips. The displayed wait includes those passes; the last 5 seconds are the countdown.
- The server owns the clock and queue. Refreshing, reconnecting, or visiting from another browser preserves the public show.
- Public queue metadata contains generated titles and approved interpretations, not raw user prompts or session identifiers.

## Connecting the physical installation later

Get an authorized organizer instance and the actual controller protocol. Build an operator-controlled adapter that samples `renderScene` or `urlFrame` at up to 30 FPS from server time, maps orientation and color calibration, and sends the exact 17×9 frames. Test in the organizer simulator before MIT-approved installation. Keep the website labeled simulator until that live path is verified.

## Organizer simulator display runner

The `display_runner/` service bridges the authoritative queue to the organizer simulator without exposing its instance name or send endpoint to browsers. Configure a strong `DISPLAY_RUNNER_TOKEN` on both the Worker and runner, then set `GREEN_BUILDING_INSTANCE` to the exact server-issued adjective-animal name. Copy `display_runner/.env.example` to the ignored `.env`, install its requirements, and run `python runner.py`.

The Worker exposes the current rendered 17-row × 9-column frame at authenticated `GET /api/display/frame`. The runner validates every RGB channel, converts the frame to the documented 459-byte row-major format, and sends through a `makeframe()`/`send()` adapter. Static clips are refreshed once per second; the organizer resumes a stored clip after two seconds without live frames. Dynamic clips and the invitation URL are sampled at no more than 30 FPS, below the simulator's 40-request-per-second ceiling. Each send waits for the target’s HTTP acknowledgment before deduplication; failed static sends are retried. Five consecutive source or target failures stop the runner. Slow networks reduce the sampling rate. Intrinsically animated shapes remain dynamic even when their layer transform is still.

Only one runner may target an instance. Use a staging-only instance until an organizer supplies the authorized physical-building adapter; clip upload and simulator lifecycle APIs are intentionally absent from the production-compatible runner.

Protocol verified against the [organizer simulator source](https://github.com/willsarg/sundai-greenbuilding-sim/blob/f7763a55e8de0537e64c0df418bf5a0a08257b73/README.md#api-reference): the binary RGB POST returns HTTP 204 when accepted for its next render tick. This is not proof of physical-building delivery.
