# Hack This Building — Pre-mortem

Draft review of [PRD v0.1](PRD-hack-this-building.md), using the installed Claude PM pre-mortem skill. These are anticipated failure modes, not observed launch failures. Team role owners below are proposed, not assigned.

## Tigers: concrete risks

| Risk | Urgency | Mitigation | Proposed owner | Decision point |
|---|---|---|---|---|
| Team builds against the prerecorded demo instead of its writable instance | Blocks simulator demo | Obtain team instance and authenticated docs; send and observe one known clip first | Display lead | First integration spike |
| “Five seconds after Submit” fails as soon as a second person joins | Blocks credible demo | Separate queue wait from final countdown; reserve start times centrally and show estimates | Scheduler lead / Ryan | Before UI and scheduler implementation |
| A 20-character URL scroll is unreadable or consumes most of the show | Blocks public participation | Test actual full URL at street/river distance; measure a readable pass and use it in capacity math | Display / design lead | Before queue limit is fixed |
| Prompt moderation passes content but generated code hangs or outputs something different | Blocks public playback | Hard isolated-render limits; validate rendered frames; exact approved clip only; operator stop | Generation lead | Before public submissions are enabled |
| Two workers write to the same display or retry an already-started clip | Blocks simulator demo | One scheduler, atomic reservations, stable clip IDs, explicit interrupted state and operator recovery | Backend lead | Before multi-user rehearsal |
| Website says “live” while the hardware is disconnected | Blocks physical session | Distinguish simulator from hardware, show connection state, use local fallback and on-site operator | Display lead / operator | Before physical rehearsal |
| Open-ended generation and voting consume the entire hack | Blocks complete demo | Ship FIFO and one complete loop first; timebox the code-render spike and decide on constrained primitives | Ryan / team | First scope checkpoint |

## Paper tigers: concerns to keep proportionate

- **Raw RGB bandwidth:** one five-second 30 FPS clip contains only 68,850 uncompressed RGB bytes. Encoding, transport latency and reliability still need testing, but this grid does not require a video streaming platform.
- **Participant accounts:** a small supervised hack demo can use temporary sessions. Authentication is still required for operator controls; stronger abuse controls may be needed for an unrestricted public event.
- **Red Sox availability:** the selected first-release prompt experience works without a live baseball game or sports API.

## Elephants: assumptions that need direct observation

- Can someone across the river identify a prompted animation in five seconds? Test with simple shapes and five new observers; record recognition rather than the team's own interpretation.
- Will someone wait through ten entries? At an illustrative 29-second cycle that is roughly five minutes. Watch queue exits and shorten capacity before overpromising.
- What did Xander already build, and who owns the rendering integration? Inspect the team's repo and working instance before duplicating it.
- Who decides an uncertain moderation case and who can stop the physical display? Name an operator and escalation path before public playback.
- Do the physical installation's color mapping, tree obstruction, connection protocol, and operating rules match the simulator? Ask the installation owners and rehearse on hardware.

## Action order

First prove the real simulator connection and readable URL. Then prove one exact preview-to-playback clip, followed by multiple visitors and error recovery. Voting and alternate content modes wait until those checks pass. Repeat the hardware-specific checks before the September 29 installation; simulator success does not demonstrate physical delivery.
