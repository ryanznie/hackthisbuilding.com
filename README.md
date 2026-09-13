# hackthisbuilding.com

**Live app:** https://www.hackthisbuilding.com

Prompt the MIT Green Building, preview a 17×9 light animation, and join a shared public show. This release renders the building in an interactive browser simulator.

The live app is in [`simulator/`](simulator), built with React, Canvas, Cloudflare Workers AI, and a Durable Object queue. The team's separate proof of concept is preserved at the repository root. See [development and deployment](docs/DEPLOYMENT.md) for local setup and operator controls.

## Product plan

- [Product requirements — public prompt-to-building experience](docs/PRD-hack-this-building.md)
- [Build graph and proposed work ownership](docs/GRAPH-hack-this-building.md)
- [Pre-mortem and demo risks](docs/PreMortem-hack-this-building-2026-09-13.md)

These documents are drafts for team review. The first-release recommendation is a public FIFO queue, approved animation previews, five-second display slots, and two full URL passes between clips.
