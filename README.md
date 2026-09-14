# hackthisbuilding.com

**Live app:** https://www.hackthisbuilding.com

Create light art, show a Red Sox score or Cambridge weather snapshot, or play Pong and Super Mario on a 17×9 window grid. Preview your lights, join one shared queue, and get a 30-second turn. The building is rendered in an interactive browser simulator.

The app is in [`simulator/`](simulator), built with React, Three.js, OpenRouter, and a Cloudflare Durable Object queue. The team's separate proof of concept is preserved at the repository root. The current source also includes an authenticated [organizer simulator bridge](display_runner/README.md). The assigned organizer instance is connected through a supervised local runner; live colored frames were verified over the organizer's WebSocket on September 13, 2026. See [development and deployment](docs/DEPLOYMENT.md) for setup, operator controls, and recovery.

The score, weather, Mario, four-color domain treatment, and bridge changes are locally implemented; their publication is pending. The public link above is the existing deployment, not evidence that every source change is live. [Acceptance results](docs/acceptance-results.md) distinguish local tests from recorded deployments.

## Product plan

- [Product requirements — public prompt-to-building experience](docs/PRD-hack-this-building.md)
- [Build graph and proposed work ownership](docs/GRAPH-hack-this-building.md)
- [Pre-mortem and demo risks](docs/PreMortem-hack-this-building-2026-09-13.md)
- [Red Sox API research and status handling](docs/research-redsox-api.md)
- [Weather API research and source provenance](docs/research-weather-api.md)
- [Ryan PR review record](docs/review-ryan-prs-2026-09-13.md)

All activities share FIFO, one active or waiting turn per visitor, visible wait estimates, and the four-color website scroll as the default building screensaver. Approved five-second light previews loop during their public turn. Red Sox and Weather are timestamped snapshots that stay fixed after approval; **Weather** is separate from the **Make it rain** art preset. The final activity button, **Super Mario**, opens an original tiny platformer with left/right/jump controls, coins, pipes, hazards, three lives, and a finish flag. Pong is inspired by [Xander Cogan’s Sundai game](https://github.com/XanderCogan/pong-hack-sundai140).

The domain wordmark uses gold for `hack`, cyan for `this`, pink for `building`, and ivory for `.com`.
