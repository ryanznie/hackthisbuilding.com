# Initial simulator acceptance — September 13, 2026

Public URL: https://www.hackthisbuilding.com

This file retains historical deployment evidence below. The latest local feature checks are in the final section; they do not establish publication or connection to an organizer instance.

| Check | Observed result |
|---|---|
| Root domain and TLS | `https://hackthisbuilding.com` returns 302 to `https://www.hackthisbuilding.com/`; app returns HTTPS 200. |
| API through Pages binding | `/api/health` returns `ok:true`, `generationAvailable:true`, `mode:simulator`. |
| Real public prompt | Browser prompt “A golden rocket rising through blue stars” produced “Golden Rocket” with a rising golden rocket and blue stars. |
| Live moderation | A hateful-symbol request was rejected with `PROMPT_REJECTED` before scene generation or queue admission. |
| Explicit submit | That exact generated preview entered the shared queue with a visible personal countdown. |
| Reaction | The queued animation received one vote; FIFO order was unchanged. |
| Playback | Production state showed the generated clip playing, `phaseStartedAt:1789318040308`, `phaseEndsAt:1789318045308` — exactly 5,000 ms. |
| Completion | Browser showed “YOU LIT UP THE SIMULATOR” / “PLAYED”; queue emptied and invitation URL resumed. |
| Reference mockup | Canvas recreates the supplied nighttime tower, radomes, beacon, campus, trees and plaza. Windows render RGB frames rather than embedding the screenshot. |
| Responsive UI | Inspected desktop and phone-sized layout; content fits viewport, prompt and submit usable. Three camera views and pause control are available. |
| Operator secret | Private key configured in Cloudflare and ignored local file; not included in repository or browser assets. |
| Automated checks | 18 tests pass; `npm run typecheck` and `npm run build` pass from `simulator/`. |
| GitHub checks | The main-branch GitHub Actions run completed installation, typecheck, all tests, and production build successfully. |

Tests cover all primitive/motion combinations, deterministic frames, strict scene validation, exact clip identity, concurrent admission/idempotency, FIFO/timing/restart catch-up, pause/resume scheduling, owner-only cancel, reaction behavior, queue bounds, origin/body validation, private visitor headers, abuse limits, bounded receipt retention, and AI output moderation/response formats.

The independent renderer reviewer tested session ownership and exact-scene admission and verified three real Workers AI inference calls in about 2.57 seconds. Those calls exposed the parsed-object model response change, which was fixed before the successful public-browser generation.

The physical installation and organizer-hosted simulator instance remain unconnected. Automatic deployment from GitHub is not configured; GitHub runs validation, and the documented local deploy command publishes the application.

## 3D upgrade — local and public acceptance, September 13, 2026

The user approved the localhost 3D experience for publication. Commit `82c63229f8dbe8d34e755c9a06ba5db4b8030121` was deployed and verified at **https://www.hackthisbuilding.com**. Cloudflare Pages deployment: `044ddfcf`; Worker version: `db024534-6f0d-4ef0-8afc-366ceef4aefe`.

| Check | Observed result |
|---|---|
| Actual 3D rendering | Real WebGL building geometry and 153 individually animated windows were observed in the browser on desktop and a 390px-wide mobile viewport. |
| Camera interaction | Keyboard orbit and camera-view changes were verified. The 153-window hotspot selects Facade; Escape closes its explanation and restores focus. Camera presentation remains separate from the shared animation clock. |
| Automated checks | 22 tests passed, including three Three.js tests and the backend regression for non-expiring curated examples. Typecheck and production build passed. |
| Existing public workflow | Real AI generation, moderation, exact-preview submission, FIFO playback, reactions and completion were previously verified on the public backend, as recorded above. |
| Public 3D workflow | The custom domain showed Interactive 3D. “A golden rocket rising through blue stars” generated Golden Ascension, visibly animated the 3D windows, joined the shared queue with a countdown, and played in the shared 3D show. |
| Publication status | Public HTML serves the new `index-DsGuTL_a.js` build. `/api/health` returned healthy with generation available. [GitHub validation passed](https://github.com/ryanznie/hackthisbuilding.com/actions/runs/34770909742). |

The renderer loads separately and retains the 2D canvas while loading or when WebGL fails. Automated checks cover the 153-window layout and RGB mapping; this is not a claim of physical-device testing or connection to MIT's building.

## Mobile and image previews — September 13, 2026

- At 390 × 844 and 375 × 667 browser viewports, the initial screen includes the compact 3D preview, prompt field, and Create preview button without scrolling. At 375px wide, that button ends at approximately 520px. Onboarding is Describe → Preview → Submit; examples form a horizontal strip.
- The exact prompt “show the sundai logo” completed real OpenRouter text moderation, image generation from the official club reference, conversion to 153 window pixels, and vision moderation. Its local shared-queue turn completed successfully.
- 38 automated tests passed. Image/provider checks also passed after updating the decompression dependency to its patched version. Dependency audit reported zero vulnerabilities.
- The key is configured as a private Worker secret and is absent from browser code and tracked files. Full generated images are not persisted in the show state.

## Shared lights/Pong queue and team presets — September 13, 2026

- Automated validation: **53 tests passed**, plus TypeScript and the production build. Tests cover mixed 60-second turns, minimum five-second notice, legacy migration, owner-only control, stale input ordering, restart, pause, deterministic game physics, and exact Heart/Smile/Arrow masks.
- At a 375 × 667 local browser viewport, the initial prompt field ends at about 501px and Create preview ends at 554px, with scroll position zero and no horizontal page overflow. Activity buttons sit above the editor.
- Local real-time run: a Red Sox rally turn showed a Pong request with **1 turn ahead** and a decreasing ETA; it handed over automatically to Pong. The player’s right-button input changed the shared server’s bottom paddle position from 3 to 4. A separate visitor received `PONG_NOT_OWNER` when attempting control.
- At the end of the real Pong turn, controls disappeared and the building returned to positive house lights. The server snapshot reported `durationMs:60000`; exact boundaries and back-to-back mode handoffs are also covered by tests.
- Heart, Smile, and Arrow come from the Kalyani branch’s original 9 × 17 POC masks at `abe693da5e8ea575180c20afb96d65f2f5b3cd1a`. Their shapes, direction and stillness are preserved as bounded pixel data; seven prior presets remain available.
- Xander’s Pong source was inspected read-only. The integrated game has its own authoritative queue and server engine; no controller lease was acquired and no frame was sent to the external `mellow-heron` instance.

The following section records the next local source revision. Its public deployment and final browser checks are still pending.

## Score, Weather, Mario, and bridge — local source acceptance

The current source passed **102 TypeScript tests** with `npm test` from `simulator/`, **13 Python runner tests**, and TypeScript type checking. These checks were run locally on September 13, 2026. The Python run used an installed environment containing `certifi`; a clean runner environment must first install `display_runner/requirements.txt`. Browser verification and publication of this combined revision have not yet been recorded.

| Area | Verified evidence | Remaining boundary |
|---|---|---|
| Red Sox snapshot | Tests cover active play, warmup, suspension, postponement/cancellation, resumed-game dates, real off-day/offseason fixtures, cache/failure behavior, and exact approved snapshot submission. Boston remains red/top and the opponent white/bottom. | The approved clip stays fixed for its turn; it is not a continuously updating scoreboard. [Research and live response evidence](research-redsox-api.md). |
| Current Weather | Seven tests cover Fahrenheit conversion, source/time metadata, condition mapping, stale/null rejection, fallback, caching, deadlines, body bounds, and negative/three-digit text. Exact live NWS and Open-Meteo payloads passed the production parsers. | NWS reports nearby Logan observations; Open-Meteo is modeled Cambridge weather. Neither is a sensor on the building. [Provider research](research-weather-api.md). |
| Weather live examples | At about 23:33 UTC, NWS returned 19°C / 66°F, Fog/Mist, observed at 23:10 UTC. Open-Meteo returned 66.4°F / 66°F, Overcast, valid at 23:30 UTC. All three researched provider endpoints returned HTTP 200. | These are timestamped captured examples, not the weather at reading time. No rain condition was inferred from the Make it rain preset. |
| Mario engine and API | Tests cover deterministic movement/jumping, platforms and hazards, lives/coins/finish state, RGB rendering, atomic shared admission, one-owner limits, queue capacity, active-only controls, stale sequence rejection across restart, pause/resume, and movement reaching the authenticated frame feed. | Pointer/keyboard interaction and final mobile layout still need the combined browser check. The game is an original 9 × 17 adaptation, not an embedded third-party controller. |
| Display feed | Tests authenticate feed/status requests, compare frames with the shared renderer, preserve intrinsically animated primitives, distinguish static output, and verify heartbeat failure before scheduler catch-up. | Connection states and HTTP acceptance are mocked in these tests; no actual organizer connection was established. |
| Runner transport | Thirteen tests cover exact RGB encoding, static deduplication only after HTTP acceptance, static retry/re-acceptance, 30-FPS limiting including retries, stale-source rejection, authentication, five-failure shutdown, and local instance locking. | No server-issued instance has been confirmed for this project. Target HTTP 204 behavior has not been tested against that instance. HTTP acceptance is not physical-delivery acknowledgment. |
| Recovery | A disconnected/expired runner pauses, returns black in the feed, preserves waiting entries, drops interrupted play, and refuses automatic resume. A heartbeat is fresh only below 3.5 seconds. | An operator must verify a real recovered target and explicitly resume; local target fallback remains necessary during a network failure. |
| Domain treatment | Source uses gold `hack`, cyan `this`, pink `building`, and ivory `.com`, preserving one readable address. | Final desktop and phone contrast/layout inspection is pending. |

The prior 60-second queue, five-second approved art loops, positive house lights, Pong, image generation, and exact team presets remain the product baseline. New Weather and Red Sox buttons create separate expiring previews, and Super Mario is the final activity choice. The changes do not reinstate the original five-second public turns or mandatory URL interludes.

[Ryan's PR review record](review-ryan-prs-2026-09-13.md) identifies the original reviewed commits, reproduced failures, and integration gaps. Its historical recommendation and test counts refer to those commits. [PR #1](https://github.com/ryanznie/hackthisbuilding.com/pull/1) was confirmed merged at commit `b5e78ff` at 23:45 UTC on September 13; PR #3 was confirmed merged at `997bb2b` at 23:50 UTC after its fixes and checks. That merge status is separate from the current product revision's publication. This local acceptance entry makes no claim that the new changes have been deployed.

The organizer protocol was independently inspected at [commit f7763a55](https://github.com/willsarg/sundai-greenbuilding-sim/blob/f7763a55e8de0537e64c0df418bf5a0a08257b73/README.md#api-reference), including [the instance source](https://github.com/willsarg/sundai-greenbuilding-sim/blob/f7763a55e8de0537e64c0df418bf5a0a08257b73/poc/src/instance.js) and [Python client](https://github.com/willsarg/sundai-greenbuilding-sim/blob/f7763a55e8de0537e64c0df418bf5a0a08257b73/poc/python/gbsim/web.py). It accepts 459 row-major RGB bytes, limits an instance to 40 POSTs per second, and returns 204 before the pending frame is applied on a 33 ms tick. The app's runner stays at 30 FPS. One-second static refresh also prevents a previously uploaded clip from taking over after two seconds without live frames. These are verified source/protocol findings, not a live test of the team's instance or a physical-delivery guarantee.

The organizer simulator and MIT physical installation remain unverified. The bridge implementation, mocked connection tests, and available public domain do not imply organizer credentials, authority over another team's instance, or actual building output.

## Published games and data release — September 13, 2026, 8:03 PM EDT

Release commit `bdad26a77c988caa1679c39df0012191561862c3` includes both merged Ryan PRs and the completed feature work. All **114 TypeScript tests**, **13 runner Python tests**, **10 validator Python tests**, typecheck, and production build passed. [GitHub validation](https://github.com/ryanznie/hackthisbuilding.com/actions/runs/34791303004) also passed.

- Worker version: `19a7a050-43cf-40b2-af2a-b7e803b15620`. Pages release: [aff6b9b1](https://aff6b9b1.hackthisbuilding.pages.dev), promoted to **https://www.hackthisbuilding.com**. Public HTML loads `index-Bnh_2zGp.js` and the health API reports healthy with text and image generation available.
- All new art, Pong, and Mario turns last 30 seconds. Migration preserves an already active legacy end. The browser verified a 30-second local Mario admission, active move-right control, jumping, and coin collection (score 10, one coin, three lives).
- The public page shows Pong, Super Mario as the final activity, 30 SEC / TURN, Red Sox score, Weather, and the separate Make it rain preset. The default shared idle display scrolls the website; glyph colors are gold hack, cyan this, pink building, and ivory .com. Matching shared 2D/3D/feed frames and expiration behavior are covered by tests.
- Actual production API calls returned Boston 4, Kansas City 1, Final, September 13, 2026; and 68°F Fog/Mist from NWS Logan observed at 7:40 PM EDT. Approved data clips remain fixed during each turn, and off-day/offseason fallback tests retain the latest completed Boston result.
- This release was deployed with the existing local Cloudflare login. GitHub checks run successfully; automated publishing skips with a notice because repository deployment secrets are not configured.
- The external Sundai instance and physical installation remain unconnected. No `DISPLAY_RUNNER_TOKEN` or private Python `VALIDATOR_URL` is configured in the public Worker; built-in moderation remains active. The runner and optional validator are included and tested, with setup documented separately.

Final public browser check: the immutable Pages release loaded Interactive 3D, all three activity buttons, separate score/weather/rain buttons, and the scrolling colored address on the actual facade. A real Pong admission started at `1789344322641` and ended at `1789344352641`, exactly 30,000 ms; the public shared API returned its authoritative ball, paddle, and score state.
