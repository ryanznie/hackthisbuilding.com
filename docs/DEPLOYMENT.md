# Running Hack This Building

The public app is at **https://www.hackthisbuilding.com**. The bare domain forwards there. The React app is deployed to Cloudflare Pages; `/api/*` is forwarded through a service binding to the `hackthisbuilding` Worker. A single Durable Object (`public-show-v1`) owns the persisted public queue. Workers AI performs prompt moderation, scene generation, and a second check of public text.

This release is an interactive **in-browser simulator**. It does not send light commands to MIT's building or the organizer's protected simulator instance. The architectural canvas follows the provided nighttime simulator screenshot and renders the same 17-row × 9-column RGB frames used by the animation engine.

## Develop

Use Node 22.12 or newer. The deployed application lives in `simulator/`; the team's separate proof of concept remains at the repository root.

```sh
cd simulator
npm ci
npm run build
npm run preview
```

For frontend hot reload, also run `npm run dev`; Vite forwards API requests to port 8787. Curated examples work without an AI connection. AI availability is explicit; an unavailable model never silently becomes a canned animation.

## Validate and deploy

```sh
npm run typecheck
npm test
npm run build
npx wrangler deploy
npx wrangler pages deploy --cwd pages --project-name hackthisbuilding --branch main
```

Run the commands above from `simulator/`. `npm run deploy` performs these steps. Sign in with `npx wrangler login` to an account that owns both projects. The Worker must be deployed before Pages because Pages binds to it. Cloudflare AI usage is charged to the deploying account under its current plan; application limits bound preview requests.

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

- A prompt is at most 280 characters. The model can compose bounded shape-and-motion instructions; it cannot execute arbitrary code or load external resources.
- Preview privately, then explicitly submit that exact server-approved clip.
- One pending or playing turn per session; at most 10 waiting turns; submissions are idempotent.
- FIFO determines turn order. Hearts are reactions and do not reorder it.
- Each clip lasts 5 seconds. The domain scrolls for two full 12-second passes between clips. The displayed wait includes those passes; the last 5 seconds are the countdown.
- The server owns the clock and queue. Refreshing, reconnecting, or visiting from another browser preserves the public show.
- Public queue metadata contains generated titles and approved interpretations, not raw user prompts or session identifiers.

## Connecting the physical installation later

Get an authorized organizer instance and the actual controller protocol. Build an operator-controlled adapter that samples `renderScene` or `urlFrame` at up to 30 FPS from server time, maps orientation and color calibration, and sends the exact 17×9 frames. Test in the organizer simulator before MIT-approved installation. Keep the website labeled simulator until that live path is verified.
