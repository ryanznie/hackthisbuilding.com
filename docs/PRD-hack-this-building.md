# Hack This Building — Product Requirements Document

**Status:** Draft v0.1 for Ryan and team review  
**Prepared for:** Wilson and the Sundai Hack 140 team  
**Date:** September 13, 2026  
**Product:** `hackthisbuilding.com`  
**Scope:** Public prompts → approved animation → preview → shared queue → MIT Green Building display

## 1. Summary

Hack This Building lets anyone describe an animation on their phone, preview how it will look on the MIT Green Building, and submit it for a five-second public display. A shared queue tells people when to look up, while the building repeatedly displays the website address so the next person can join. The first release demonstrates this full loop in the event simulator; a physical installation depends on the event team's approval and hardware integration.

**Recommended first release:** a visible first-come-first-served queue, one pending submission per visitor, a five-second final countdown, five seconds of animation, and two complete URL scrolls between animations. Upvotes can be added later; random selection should be an explicitly labeled event mode rather than the default.

## 2. Contacts

| Person or group | Role in this document | What needs their input |
|---|---|---|
| Ryan Nie | Idea originator; proposed product decision owner | Queue policy, timing, interpretation of two URL cycles |
| Wilson | Requested PRD and domain setup | Scope review, domain and deployment coordination |
| Xander Cogan | Reported working on moving URL display | Reuse of existing rendering work, repo and simulator instance |
| Kalyani G, Zach Derhake, Skylar Wooster | Team participants named in the supplied Discord thread | Engineering and demo ownership to be agreed |
| Sundai / E14 organizers and MIT installation team | Event and physical display owners | Display access, brightness and animation rules, live installation approval |
| Display operator | Role to assign before a public session | Pause, remove submissions, handle display failures |

These are planning roles, not assignments made on anyone's behalf. No messages have been sent to teammates.

## 3. Background

Sundai Hack 140 asks teams to turn the Green Building into a responsive physical interface. The event describes 153 lit windows and a 30 FPS display; the supplied code defines **17 rows and 9 columns**. The public event schedule lists simulator demos at 20:00 on September 13 and a planned building installation on September 29 at 18:30, with concepts subject to MIT approval. [Event](https://www.sundai.club/events/boston/beyond-tetris-building-scale-physical-ai-for-mit-green-building), [display definitions](https://github.com/Nevin-Thinagar/17x9-Tetris/blob/main/utilities/display.py)

Ryan's Discord proposal is the primary product input: enter a prompt, validate it with an LLM, generate code, preview the result, explicitly submit it, receive a countdown, and see a short display before the URL returns. His follow-up proposes a public queue, upvoting, or random selection. The team reports that Xander already has moving URL output; this implementation has not yet been inspected. The team repository is [ryanznie/hackthisbuilding.com](https://github.com/ryanznie/hackthisbuilding.com), and Wilson's write access has been verified. At initial inspection it contained a README and `.gitignore`, with no application or deployment configuration yet.

The brainstorming document also lists Red Sox scores and Pong. This PRD follows the user's latest direction: build public prompt participation first. Sports scores and games remain possible later content sources, using the same display pipeline. [Brainstorming](https://docs.google.com/document/d/1LpTe1zqIQ7gq_x_a_4Wq1Gc0hUlcSwhqz_Ra7sN38Gk/edit)

**Verified integration distinction:** the supplied `/demo/sundai-float` page loads a prerecorded animation. It is a visual reference, not the team's writable instance. The simulator homepage provides password-protected instance creation and API documentation. Its public viewer code shows RGB frame submission and a separate live viewer connection. We have inspected that code but have not sent a frame to a team instance. [Demo](https://sundai.willsarg.com/demo/sundai-float?view=street), [simulator](https://sundai.willsarg.com/)

The resource pack contains mobility, weather, civic, event, and music data options. None is needed for this first release. The supplied `sundai.club/guide` link returned a 404, so no slide content is assumed. [Resource pack](https://docs.google.com/document/d/1aArBDnVOuubj2fM4UaW0WBud_pek5uR62GtUUr9KQCU/edit)

**Domain status:** Porkbun confirmed successful registration of `hackthisbuilding.com`; domain management shows an expiration date of September 13, 2027. Registration is complete; app deployment and DNS routing are separate work.

## 4. Objective

Give a member of the public a clear, rewarding moment: “I typed that, and now the building is showing it.” The product should be understandable without coding knowledge or help from the team.

The numbers below are **proposed acceptance targets**, not measured results or guaranteed service levels.

| Result | Target for the first demo | How to measure |
|---|---|---|
| First-time participation | At least 4 of 5 new testers create a preview and join the queue without coaching | Observe a short phone test |
| Creative relevance | At least 8 of 10 simple, allowed prompts produce a recognizable version of the request | Team reviews prompt and exact preview together |
| Preview speed | At least 9 of 10 warm requests produce a preview or clear failure within 20 seconds | Server request and result timestamps |
| Successful delivery | All 10 accepted rehearsal submissions play once in the intended order | Scheduler log and independent simulator observation |
| Predictable timing | Five-second clips finish within one frame of their configured duration; online clients' final countdown is within one second of the scheduler | Timestamp trace and two-device observation |
| Public display control | Every queued clip has completed all validation steps; blocked fixtures never reach the display; operator pause works | Positive and negative acceptance scenarios |
| Invitation loop | Two complete, readable URL passes appear after every user clip | Observe rendered output, including realistic distance view |

Event analytics should count preview requests, failures, submissions, queue exits, playback starts and finishes. Use temporary anonymous session IDs. Public queue data must not expose contact details, IP addresses, raw rejected prompts, or model instructions. A proposed initial retention period is seven days for private debugging records; confirm retention before the physical event.

## 5. Market segments

| Segment, defined by its job | Need | Product response |
|---|---|---|
| A passerby who wants to participate | Turn an idea into building art without installing an app | Mobile website, examples, a short prompt and one clear preview action |
| A participant waiting for their turn | Know whether to stay and when to look up | Public queue, personal position, estimated wait, final countdown |
| A spectator who only wants to watch | Understand what is happening and how to join | Current display, next items, recurring website invitation |
| An operator running a shared public screen | Keep the show moving and recover from bad content or outages | Queue controls, clear device status, immediate fallback |

Audience size is unknown. For the hack, rehearse with 20 connected viewers and 10 submissions before claiming support for a larger crowd. Public participation does not require a social account or download; operator access does require authentication.

## 6. Value propositions

- **Make something together:** participants briefly share a real building as their canvas.
- **Know what will happen:** the exact low-resolution preview and visible queue reduce uncertainty about the result and the wait.
- **See cause and effect:** a final countdown directs attention from the phone back to the building.
- **Keep inviting the crowd:** the building's URL display is part of the experience and continuously brings in new participants.

The proposed advantage is the complete public participation loop around a physical display. No customer research or competitor comparison has yet established demand or superiority.

## 7. Solution

### 7.1 Public journey and screen states

1. **Discover.** Read `hackthisbuilding.com` on the building, or scan an organizer-provided QR code on a sign. Open the mobile site.
2. **Describe.** Enter a short request such as “a red heart that beats” or “a rocket rising into stars.” Explain that the result is simple window-sized pixel art. Suggested initial limit: 280 characters.
3. **Preview.** Select **Create preview**. Show progress while the prompt is checked and the animation is generated and validated. The public queue is unchanged at this point.
4. **Review.** Show the five-second animation on the actual 17 × 9 grid and a building view. Offer **Edit prompt**, **Try again**, and **Submit to building**. Editing invalidates the previous preview.
5. **Join.** Submit the approved preview. Show confirmation, a stable submission ID, queue position, and estimated wait. A second tap must return the existing submission instead of creating another one.
6. **Wait together.** Everyone can see the current item and accepted queued items. Highlight the visitor's own item. Offer cancellation while it is still waiting.
7. **Look up.** When the item has a reserved start time and is five seconds away, show “Look up — your turn in 5…4…3…2…1.”
8. **Play.** Display the approved animation for five seconds. The website shows time remaining and clearly identifies whether output is the simulator or a connected physical display.
9. **Invite again.** Run the URL for two complete passes. Mark the submission complete and let the visitor make another.

The first mobile screen should show the current building display, prompt input, main action, and a compact queue summary. Preview and queue are distinct states: **creating a preview does not reserve a place**. Reserve space for useful errors and status messages. Support keyboard input, labeled buttons, visible focus, and a reduced-motion preview; do not communicate state only through color. No separate visual mockup has been produced yet; this flow is the design reference for the stories below.

### 7.2 Timing and URL rules

“Five seconds after Submit” is achievable only when a display slot is actually available. Under load, the app must say **estimated wait** rather than promise immediate playback. The five-second display duration is distinct from generation time, queue wait, and the final countdown.

| State | Building output | Website behavior |
|---|---|---|
| Idle | URL loops continuously | Ready for prompts; no promised slot until submission succeeds |
| Inviting between clips | Two full URL passes | Estimated waits update; next clip is reserved near the end |
| Final five seconds | Finish the required URL passes, or continue URL output until the reserved start | “Look up” countdown for the next participant |
| Playing | One approved five-second clip | Playing label and five-second remaining time |
| Paused or disconnected | Local fallback if available; operator controls physical recovery | “Display paused” or “Connection lost”; no ticking promise of an imminent turn |

**Proposed scheduling rule:** after each clip, finish two complete URL passes. Reserve the next item with at least five seconds of notice; the countdown may overlap the last five seconds of the invitation period. If an item arrives too late for that boundary, continue URL output until its five-second notice completes. Finish any URL pass already in progress before a new clip. The initial startup also completes two passes before its first clip. Do not interrupt an animation for a newly submitted prompt.

One URL cycle means one complete readable pass of the full domain, including the dot and `.com`. It does not mean a fixed five-second timer. The domain has 20 characters and will need scrolling or another readable sequence on a nine-column display. Keep the essential URL above rows hidden by the simulator's realistic tree-line option. Use a printed QR code near the audience; the building grid is too small for a normal QR code.

**Illustrative capacity calculation:** if one URL pass takes 12 seconds, the minimum busy loop is `5 + 2 × 12 = 29 seconds`, because the final countdown overlaps the invitation. That is about 124 clips per hour before extra waiting or recovery. Ten items ahead can mean roughly five minutes. Measure actual URL duration and legibility before fixing queue capacity or publishing wait claims.

### 7.3 Queue decision

| Policy | Benefit | Cost | Recommendation |
|---|---|---|---|
| Visible first-come-first-served | Predictable order and useful wait estimate | Repetition and spam need limits | P0 default |
| Upvotes determine order | Adds crowd choice | Later items can overtake users; vote abuse and starvation need rules | Later experiment |
| Random selection | Creates surprise | Ordinary wait estimates become misleading; some users may never play | Separate optional mode |

For the first release, order by the time a valid **Submit** reaches the server, with a stable server sequence number for ties. Allow one queued or reserved item per anonymous session. Use a configurable queue limit, initially 10 waiting items; if full, retain the preview and show an honest queue-full message. Do not silently accept work that will miss the end of the event.

**P1 voting:** show one removable upvote per visitor per queued item, with a visible count. Keep FIFO order initially and label votes as reactions so they do not imply priority. If voting later affects selection, protect the next reserved item, state tie-breaking and a maximum wait, and display estimates as estimates.

**P2 random mode:** choose only among approved waiting items, select without replacement, and keep a visible “random selection” label. Show the next draw time rather than a personal guaranteed start time. A repeated event cannot promise that every entrant will be selected before closing.

### 7.4 Content generation and validation

Preserve Ryan's intent to generate animation code, while publishing only the exact finished animation the user approved.

1. Check the prompt for the event's agreed content rules, requests to override instructions, and attempts to insert executable commands or external destinations.
2. Generate a small animation against a narrow drawing interface, with a fixed frame count and allowed colors. No user-selected packages, external URLs, or arbitrary HTML.
3. Render it in an isolated environment with no credentials, no network or subprocess access, and hard time and memory limits. A model saying “safe” is not a substitute for those restrictions.
4. Check every frame for valid dimensions and RGB values; review the rendered output for prohibited content and the organizer's brightness and flashing rules. Uncertain or failed checks do not enter the public queue.
5. Save an immutable five-second clip. Bind preview, approval, queue entry, and playback to that clip's ID and content hash. Do not regenerate it after the user presses Submit.
6. Send only validated frames through the display adapter. The building controller must never execute generated code.

If safe code rendering cannot be demonstrated during the first implementation spike, propose a documented fallback: the model selects and parameterizes approved animation primitives. Tell the participant when their idea has been simplified and require preview approval. This is a scope tradeoff for Ryan to accept, not an assumed equivalent to unrestricted generation.

At 30 FPS, a five-second clip contains 150 frames. Each uncompressed RGB frame is `17 × 9 × 3 = 459` bytes, or 68,850 bytes per clip before metadata. The reference repo caps `Display.send()` at 30 calls per second. [README](https://github.com/Nevin-Thinagar/17x9-Tetris/blob/main/README.md)

### 7.5 P0 user stories and acceptance criteria

All stories refer to the journey in §7.1. File and integration dependencies appear in the companion build graph; user stories are not assumed to be technically independent.

**P0-1 — Create a preview.** As a participant, I want to see my idea on the window grid before sharing it.

1. Empty or over-limit prompts produce a clear inline message and no generation request.
2. Allowed input produces progress followed by either a five-second preview or a readable failure.
3. Preview dimensions are 17 rows × 9 columns; phone previews do not imply detail the building cannot display.
4. Retry and edit create a new preview version; neither adds to the queue.
5. A failed or unfinished preview cannot be submitted, and the prompt remains available for editing.

**P0-2 — Enter the shared queue.** As a participant, I want an explicit place in line for the preview I approved.

1. Submit enqueues only the current, validated clip and returns its stable ID and position.
2. Double taps and retries return one entry for the same submission request.
3. The same session cannot hold a second active queue slot; a full queue clearly declines new entries.
4. A queued participant can cancel before their item is reserved; cancellation updates everyone's wait estimates.
5. Refreshing restores the participant's item while their session persists; closing the page does not cancel it.

**P0-3 — Watch and understand the queue.** As a spectator, I want to see what is playing and what comes next.

1. All visitors can view current and accepted waiting items without signing in.
2. Cards expose a moderated title and approved thumbnail, plus position and estimated wait; raw prompts are private by default.
3. The visitor's own item is highlighted and the next reserved item stays stable.
4. Two devices receive consistent ordering and status; stale state shows a reconnecting label.
5. Pauses, cancellations, and failures update estimates instead of allowing a countdown to pass below zero.

**P0-4 — See my work on the building.** As a participant, I want a clear signal to look up at the right moment.

1. The server reserves a start time at least five seconds ahead; the participant sees the final countdown.
2. Playback uses the exact approved clip, begins at the scheduled boundary, and lasts five seconds.
3. Exactly one scheduler writes to the team display; simultaneous submissions do not interleave frames.
4. Two complete URL passes follow each clip, even if the queue is nonempty.
5. The website uses “Live on building” only when connected to the physical display; simulator sessions say “Simulator.”

**P0-5 — Keep a public display usable.** As an operator, I want to prevent inappropriate output and stop the show when needed.

1. Prompt, render, and output checks must succeed before an entry becomes public.
2. Authenticated operators can pause, remove a queued entry, stop a playing clip, and resume.
3. Operator stop returns to an approved fallback within one second on a healthy connection; disconnected hardware requires the local fallback/operator procedure.
4. A transport failure pauses new dispatch and marks interrupted playback explicitly. Recovery does not automatically replay an item with uncertain delivery.
5. Rejected content, provider credentials, and the writable display endpoint are absent from public responses.

### 7.6 Technology and failure behavior

Keep these boundaries even if the team changes languages or hosting providers:

| Component | Responsibility |
|---|---|
| Mobile website | Prompt, preview, current show, personal countdown, public queue |
| Generation service | Prompt checks, bounded generation, render checks, approved clip storage |
| Queue and scheduler | Atomic admission, consistent ordering, timing, one display writer, recovery state |
| Display adapter | Convert approved frames to the actual simulator or hardware transport |
| Operator view | Authenticated pause, removal, stop, fallback, and device status |

The public viewer code shows `POST /api/i/{instance}/frame` for frames and a WebSocket viewer at `/api/i/{instance}/view`. This is source inspection, not an authenticated API test. Obtain the team's actual instance, credentials, API docs, row orientation, and physical transport before implementing the adapter. The public Tetris `Display` class is abstract; that repo alone does not establish the physical connection protocol.

The scheduler is the authority for time. Client timers derive from its timestamps and resynchronize after reconnecting. Enqueueing is atomic; preview work never writes to the building. Queue persistence and display dispatch logs must survive a scheduler restart sufficiently to distinguish waiting, reserved, started, finished, and interrupted items. Do not claim exactly-once physical delivery without acknowledgment support from the hardware.

On generation failure, keep the prompt and offer retry. On rejection, give a short explanation and invite editing. On display failure, stop accepting new submissions if the wait cannot be estimated; preserve existing accepted entries and tell their owners the show is paused. When the queue is empty, the URL remains the display's useful default. The physical install needs a local fallback because a disconnected server cannot push one.

### 7.7 Assumptions and open decisions

| Item | Proposed default or known limit | Owner / decision point |
|---|---|---|
| Meaning of two cycles | Two full URL scrolls between user clips | Ryan, before timing implementation |
| Meaning of five seconds | Final countdown and clip length; queue wait is separate | Ryan, before UI copy is finalized |
| Queue selection | Public FIFO for the first release | Ryan and team, first scope review |
| Current team work | Reuse Xander's URL rendering if compatible; team repo is available; rendering code has not yet been shared there | Xander / team, before adapter work |
| Live simulator access | Need team instance and event documentation | Display lead, first integration spike |
| Code execution environment | Isolated rendering with hard limits; otherwise proposed primitive fallback | Generation lead, first integration spike |
| URL legibility | Must be tested at distance; scrolling speed is not yet fixed | Design / display lead, before queue capacity is fixed |
| Content and light limits | Event owner sets the public rules and physical brightness/flash constraints | Operator / organizers, before public playback |
| Anonymous visitor identity | Good enough for a small demo; cookies alone do not prevent determined abuse | Backend lead, crowd rehearsal |
| Expiry of unused previews | Proposed 30 minutes, then regenerate before submission | Backend lead, initial build |
| Hosting and DNS | Domain purchased at Porkbun; deployment target still to be chosen | Wilson / deployment lead, before launch |

## 8. Release

### First release: the complete public loop

Build P0-1 through P0-5, then rehearse on two phones and the team's writable simulator. Keep scope to short generated animations, a public FIFO queue, exact preview-to-display matching, honest countdowns, recurring URL, and operator recovery. Accounts for participants, voting-based scheduling, random draws, Red Sox data, Pong, payments, audio, and long-form video are outside this first release.

| Relative phase | Outcome | Completion evidence |
|---|---|---|
| First 30–45 minutes of implementation | Freeze frame/clip/queue contracts; prove one clip reaches the real team instance; prove safe rendering approach | Approved clip visible in simulator, recorded API contract, sandbox result |
| Next 60–90 minutes | Website, generation, and scheduler progress in parallel against agreed contracts | Each lane returns its component and evidence |
| Next 45–60 minutes | Integrate one complete phone-to-simulator loop | Two clients observe one consistent queue and exact playback |
| Final 30–45 minutes | Rehearse errors, crowd behavior, URL legibility, and deployed HTTPS access | Acceptance scenarios pass; operator can recover |

These are planning estimates for a small team with working tools and access. They are not a commitment from any teammate. The externally fixed event demo time appears in §3; reserve rehearsal time ahead of it.

### Later releases

**P1:** queue reactions/upvotes, report controls, stronger abuse limits, shareable completed clips, accessibility refinements informed by users, clearer operator diagnostics.

**P2:** a transparent crowd-vote scheduling experiment, labeled random rounds, themed events, sports-score animations, or games. Preserve the same validated clip and display contracts where possible.

### Release decision

The simulator demo is ready when the acceptance scenarios pass, the public URL reaches the intended app over HTTPS, the team can identify its active display mode, and an operator can pause and recover. The physical event additionally requires explicit organizer/MIT approval, a verified hardware adapter, on-site legibility checks, approved light limits, and a local disconnect fallback.

Companion documents: [build graph](GRAPH-hack-this-building.md) and [pre-mortem](PreMortem-hack-this-building-2026-09-13.md). No application implementation or deployment is claimed by this draft.

Prepared using the installed Claude PM `create-prd` and `user-stories` skills, with the supplied Discord excerpts and linked primary sources. Product recommendations and acceptance targets are labeled above; no user interviews or load tests have been performed.
