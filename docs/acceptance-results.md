# Initial simulator acceptance — September 13, 2026

Public URL: https://www.hackthisbuilding.com

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

## 3D upgrade — local acceptance, September 13, 2026

The user approved the localhost 3D experience for publication. These checks cover the current local upgrade; they do not establish that the newest version has reached the public domain.

| Check | Observed result |
|---|---|
| Actual 3D rendering | Real WebGL building geometry and 153 individually animated windows were observed in the browser on desktop and a 390px-wide mobile viewport. |
| Camera interaction | Keyboard orbit and camera-view changes were verified. Camera presentation remains separate from the shared animation clock. |
| Automated checks | 22 tests passed, including three Three.js tests and the backend regression for non-expiring curated examples. Typecheck and production build passed. |
| Existing public workflow | Real AI generation, moderation, exact-preview submission, FIFO playback, reactions and completion were previously verified on the public backend, as recorded above. |
| Publication status | Local acceptance complete; newest public deployment still requires verification. |

The renderer loads separately and retains the 2D canvas while loading or when WebGL fails. Automated checks cover the 153-window layout and RGB mapping; this is not a claim of physical-device testing or connection to MIT's building.
