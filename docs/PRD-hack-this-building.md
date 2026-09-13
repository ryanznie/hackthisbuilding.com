# Hack This Building — Product Requirements

**Revision:** v0.4 · September 13, 2026
**Team:** Ryan Nie, Wilson, Xander Cogan, Kalyani G and the Sundai Hack 140 team
**Product:** https://www.hackthisbuilding.com
**Scope:** A mobile public canvas with prompted light art, images, score/weather snapshots, Pong, Super Mario, and one shared queue.

This revision incorporates Ryan's requests for a minimal phone interface, Xander's Pong game, the latest thirty-second turn limit, queue position and ETA, and a four-color website screensaver when nobody is waiting. It supersedes the original five-second public turns and mandatory two URL passes. Five seconds remains the private animation loop length. Earlier requirements remain in Git history; deployed evidence is recorded in [acceptance results](acceptance-results.md).

It also adds the current/latest completed Red Sox score, a separate current-weather button, an original building-scale Mario platformer, a four-color domain wordmark, and an authenticated organizer simulator bridge. These additions are implemented in the local source; new browser and deployment acceptance is still pending. The organizer's actual instance and physical installation have not been verified.

## Product promise

Anyone can open the website, create something or choose a game, and know when their turn on the building starts. The browser shows an interactive interpretation of MIT's Green Building with exactly 17 rows × 9 columns of lights. The current deployment is a browser simulator; actual building output requires the organizer's approved connection.

## The first phone screen

- Show the compact building view, a short instruction, mode choices, and the primary action without making the visitor scroll to type.
- Use **Create lights**, **Play Pong**, and **Super Mario** as the activity choices, with Super Mario last.
- Lights onboarding is **Describe → Preview → Submit**. No account or installation is required.
- Keep examples in a compact horizontal strip. Put the full public queue and secondary explanation below the main interaction.
- At 375 × 667 and 390 × 844, the prompt field and preview button must fit above the fold. Keep touch targets usable and preserve keyboard access.
- Color the domain consistently: `hack` gold (`#faca4c`), `this` cyan (`#69c1fa`), `building` pink (`#f779a6`), and `.com` ivory (`#f5f3e6`). Keep the full address readable as one link.

## Activity modes

### Create lights

1. Enter up to 280 characters, or choose a curated example such as a heart or Red Sox rally.
2. Create a private preview. Ordinary motion requests generate validated shape instructions. Image or logo requests use image generation and are reduced to the 153-window grid.
3. The exact request “show the Sundai logo” is allowed. Use the official club reference and simplify its cone emblem; the full wordmark is too detailed for nine columns.
4. Submit explicitly. Previewing does not reserve a queue slot.
5. During the thirty-second public turn, loop the approved five-second animation. Do not regenerate or replace the approved scene.

### Red Sox score and Weather

The **Red Sox score** button creates a factual preview from MLB data. Prefer an active Boston game; otherwise show the most recent completed result, including on rest days and during the offseason. Show both teams, score, game date, Live/Final status, inning or delay where available, and capture time. Boston remains the upper red score and its opponent the lower white score.

Warmup, suspended, postponed, cancelled, or scheduled games must not replace a real final score with a placeholder 0–0. Preserve an in-game delay's actual score and label. A resumed game uses its actual resumption date rather than being discarded because its original official date is old. Missing or unverifiable data produces a readable failure. The bounded history lookup covers the current and previous season; [the research report](research-redsox-api.md) records provider behavior, access limitations, and verified examples.

The separate **Weather** button shows current conditions near MIT's Green Building: temperature in Fahrenheit, a clear day/night or cloud/rain/snow/fog/thunder icon, a precise condition label, source, and valid timestamp. Prefer a recent NWS observation from nearby Logan (KBOS); if unavailable, use clearly labeled Open-Meteo modeled Cambridge conditions. Null, old, unknown, or invalid values must not become a guessed temperature or sunny default. Keep **Make it rain** as an independent creative art preset; its existence is not evidence that it is raining. [Weather API research](research-weather-api.md) records source selection and freshness rules.

Both buttons create private previews that expire after five minutes. Explicit submission enters the ordinary light queue. The approved snapshot stays fixed for its thirty-second turn; later upstream changes do not replace the participant's approved pixels. New clicks can retrieve newer data. These are data-backed snapshots, not continuously updating scoreboards or emergency alerts.

### Play Pong

1. Select **Play Pong**, then **Join Pong queue**.
2. The visitor receives the same FIFO position, ETA and final countdown as an art submission.
3. Their thirty-second turn runs Pong on the shared 9 × 17 facade. The visitor controls the bottom paddle; the top paddle is computer-controlled.
4. Offer large phone controls and a horizontal paddle slider. Show scores and time remaining.
5. The server accepts input only from the active turn's owner. Spectators and expired turns cannot move the paddle or extend the timer.
6. End the game at the scheduled boundary and hand the display to the next project. Closing the controller does not prevent the queue from moving on.

The Pong experience is based on the team contribution at [XanderCogan/pong-hack-sundai140](https://github.com/XanderCogan/pong-hack-sundai140). Its standalone page writes directly to a separate Sundai instance and attempts to acquire control when loaded. The integrated experience uses this application's scheduler and input ownership; it does not embed that auto-acquiring page or claim its busy external controller.

### Super Mario

The final activity button opens an original 9-column × 17-row platformer adapted to the building, using locally drawn pixel art and server-owned game logic. The participant joins the same queue for 30 seconds, moves left/right, jumps onto platforms and over gaps, collects coins, avoids pipes and hazards, and reaches a finish flag. The game begins with three lives and exposes score, coins, lives, and progress. A win or game over retains the result until the scheduled end; it does not extend or skip another participant's turn.

Offer at least 44-pixel touch controls and keyboard movement with Left/Right or A/D and jumping with Space/Up/W. Keyboard shortcuts apply only when the game controls are focused. Only the active owner may send input. Clear held controls on blur, hiding the page, cancellation, and navigation; server-side direction expiry after 400 ms prevents a disconnected controller from walking indefinitely. Send at most eight updates per second, with monotonic sequence numbers and one command per jump press.

## Queue and timing

| Rule | Behavior |
|---|---|
| Selection | First valid server admission, first shown. Hearts are reactions and do not reorder the line. |
| Turn length | 30 seconds for lights, data snapshots, Pong, or Super Mario. |
| Notice | At least five seconds before the first promised start. Later queued turns start at the preceding turn's end when notice already exists. |
| Late arrival | If only two seconds remain and nobody was waiting, give five seconds' notice and fill the three-second gap with the idle show. |
| Position | Show the number of turns ahead, including the currently playing turn when applicable. |
| ETA | Derive the start and remaining time from server timestamps; update after cancellations or operator actions. |
| Limits | One waiting or playing turn per anonymous visitor; at most ten waiting entries across all activities. |
| Retries | Repeated submission requests return the same admission instead of creating another turn. |
| Cancellation | The owner may cancel while waiting, except during the final reserved five seconds. |
| Pause | Remove ticking start promises; operator resume recalculates the line. |

For an empty queue, an admission at time 0 starts at second 5. Two following admissions start at seconds 35 and 65. A continuously busy queue serves approximately 120 turns per hour, excluding pauses and initial notice. No mandatory 24-second URL interlude separates turns in this revision.

## When nobody is waiting

The default building screensaver scrolls the complete domain hackthisbuilding.com, with hack in gold (#FACA4C), this in cyan (#69C1FA), building in pink (#F779A6), and .com in ivory (#F5F3E6). Each complete pass takes twelve seconds. Server time synchronizes the scroll across the 2D view, 3D facade, and organizer display feed, regardless of when a viewer opens the page. Use this same screensaver during scheduling gaps. When a queued turn begins, its content takes over automatically; the screensaver does not reserve a queue entry or delay the next turn.

## Content and implementation boundaries

- OpenRouter credentials stay in the server's private secret store. Browser requests and repository files never contain the key.
- Benign logos, club marks and sports symbols are permitted. Prompt safety checks still apply to the whole request.
- Shape instructions use a bounded vocabulary. Image results are validated PNGs converted to 153 bounded RGB values and checked by a vision model before approval.
- No submitted code, arbitrary remote project URL, or model-generated script executes in the building controller.
- The stored queue references the exact approved scene. Full generated images are not persisted.
- Server-owned Pong physics, turn identity and monotonic input ordering keep spectators consistent and reject stale controls.
- Mario uses the same active-owner, sequence, restart, and scheduled-boundary protections.
- The 2D fallback, 3D facade, and authenticated display feed use the same frame-selection logic, including five-second art loops, Pong, Mario, and idle output.
- Operator pause, skip and removal remain authenticated. A simulator label must not imply a physical building connection.

## Organizer simulator connection

An operator-run bridge reads authenticated `GET /api/display/frame` snapshots and posts health to `POST /api/display/status`. The Worker and runner share a private `DISPLAY_RUNNER_TOKEN`; the organizer-issued instance and endpoint stay in local runner configuration. Loading a public visitor page must not claim a separate organizer instance.

The runner sends each exact 459-byte row-major RGB frame at no more than 30 frames per second and records API acceptance only after HTTP 204. The organizer API permits up to 40 POSTs per second, applies pending frames on a 33 ms tick, and can coalesce intermediate frames. A 204 response does not acknowledge browser rendering or physical delivery. Static output is re-sent about once per second before reporting continued connection; this also keeps an uploaded organizer clip from resuming after two seconds without live frames. A failed POST cannot be deduplicated as successful. These behaviors follow the [pinned organizer API reference](https://github.com/willsarg/sundai-greenbuilding-sim/blob/f7763a55e8de0537e64c0df418bf5a0a08257b73/README.md#api-reference) and [instance implementation](https://github.com/willsarg/sundai-greenbuilding-sim/blob/f7763a55e8de0537e64c0df418bf5a0a08257b73/poc/src/instance.js). Animation primitives with intrinsic movement remain dynamic even when their layer motion is `still`.

When bridge mode is configured, a failed connection or heartbeat age of 3.5 seconds pauses scheduling before queued turns can be consumed. Preserve waiting entries, drop interrupted playback, send black to the target where possible, and clear imminent-start promises. Reconnection never resumes the queue automatically. Once the target API accepts frames again and the operator verifies recovery, an authenticated operator resumes from a trusted local tool; the next waiting participant receives a new countdown. A disconnected target still needs the organizer's local fallback.

The bridge and these failure rules have automated coverage with mocked API acceptance. A real organizer-issued instance, live accepted POSTs, observed viewer output, row orientation, and physical output remain acceptance requirements, not established facts. See [deployment instructions](DEPLOYMENT.md) and the [Ryan PR review record](review-ryan-prs-2026-09-13.md).

## Acceptance

1. A new phone visitor can type and create a preview without scrolling past explanatory content.
2. A benign Sundai-logo prompt produces an image preview; inappropriate generated output cannot be queued.
3. Lights, data snapshots, Pong, and Mario share one FIFO line, with correct position and ETA across two visitors.
4. All turn types occupy exactly thirty seconds. Art loops through its five-second content for that full turn.
5. Only the active Pong owner can move the paddle. Inputs after the turn ends are rejected, and the next project starts.
6. Idle animations appear when no project is active, without adding fake queue entries.
7. Cancellation, pause, resume, server restart and a late arrival preserve honest timing and stable ownership.
8. HTTPS deployment, automated checks, desktop behavior and the two phone viewport sizes are verified before a release is described as live.
9. A no-game day, warmup, or suspension shows the latest usable final Red Sox result; active and resumed games retain accurate status and date.
10. Weather shows sourced current Fahrenheit conditions and a timestamp, with a separate Make it rain preset. Source failure creates no invented preview.
11. Mario touch/keyboard controls operate only for the active owner; coins, hazards, lives, finish state, input expiry, and 30-second handoff work on the shared display.
12. Lost bridge heartbeat pauses before consuming queued turns. Static re-acknowledgments, preserved waiting entries, dropped interrupted play, and explicit recovery are verified against the intended organizer instance before claiming connection.

## Release and open work

This release serves the browser simulator. Team testing should include multiple phones on shared Wi-Fi and a full mixed-mode queue. GitHub validates changes; deployment remains an explicit Cloudflare publish step.

The organizer simulator bridge still needs the actual authorized instance and a live end-to-end test. Physical installation additionally needs approved hardware transport, on-site legibility and brightness checks, and a disconnect fallback. Continuously changing an approved sports/weather turn, arbitrary third-party projects, two remote human Pong opponents, and vote-based queue ordering are outside this revision.

Prepared from Ryan's and the user's product directions, the team's repositories, the [Sundai event](https://www.sundai.club/events/boston/beyond-tetris-building-scale-physical-ai-for-mit-green-building), and the implemented app. The initial PRD used the Claude PM create-prd and user-stories skills; this revision replaces its timing and activity scope with the team's latest decisions.

## Kalyani branch presets

Expose **Heart**, **Smile**, and **Arrow** as the first quick-pick buttons. Preserve the exact 9 × 17 masks from `app/page.tsx` on [the Kalyani branch](https://github.com/ryanznie/hackthisbuilding.com/tree/Kalyani), inspected at commit `abe693da5e8ea575180c20afb96d65f2f5b3cd1a`. These are instant, static previews adapted to illuminated windows; submission follows the same 30-second light-turn queue. Keep the seven existing animated presets, including Red Sox rally.
