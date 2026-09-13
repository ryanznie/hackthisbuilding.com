# Public building simulator

Live: https://www.hackthisbuilding.com

This folder contains the public light-prompt, Pong, and Super Mario application. All modes share a FIFO queue with 30-second turns, positions and wait estimates. When no turn is active, the facade scrolls hackthisbuilding.com: hack in gold, this in cyan, building in pink, and .com in ivory. The screensaver uses server time so every viewer and the organizer feed stay synchronized. The current source adds an orbitable Three.js building with 153 live windows arranged in a 17 × 9 grid. Drag or use the arrow keys to orbit; scroll, pinch, or use +/− to zoom; Home resets the view. Camera movement preserves the approved animation and shared show timing.

The 3D renderer loads separately. A 2D canvas remains available during loading or if WebGL fails, so the prompt and queue continue working. The simulator is isolated from the team's root proof of concept so both can evolve during the hack.

```sh
npm ci
npm run build
npm run preview
```

Run `npm run deploy` from this folder to validate, build, and manually publish the Worker followed by Pages. Git pushes run validation but do not automatically publish. See [deployment and operator instructions](../docs/DEPLOYMENT.md), [recorded acceptance and publication status](../docs/acceptance-results.md), and the [PRD](../docs/PRD-hack-this-building.md).

Pong players control the orange bottom paddle against the blue computer paddle. The server owns the game and accepts input only from the active player; every visitor sees the same game. This adapts the idea from [Xander Cogan’s Sundai Pong](https://github.com/XanderCogan/pong-hack-sundai140) without claiming its external display controller.
