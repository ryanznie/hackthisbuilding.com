# Interactive 3D adaptation

The requested reference is Amir Mušić's [Veyra v1.0.0](https://github.com/amirmushichge/veyra-interactive-car/releases/tag/v1.0.0), pinned to `5779ec0762559b84bd5da3b6ffccf76e747f7587`. The reference's authored stills and short films provide its appearance; it has no runtime 3D model. This project applies its composition and interaction-continuity methods to a real Three.js building scene.

The building is a visual architectural interpretation of MIT's Green Building and the provided Sundai simulator screenshot, not a surveyed digital twin. Its public display is exactly 17 rows × 9 columns. The application's approved frame renderer and server-owned queue remain authoritative; changing the camera does not modify or restart the animation.

## Work boundaries

- Three.js lane: scene geometry, camera presets/orbit, display texture or instancing, lighting, resource cleanup and frame mapping.
- UI lane: framed composition, scene loading/error boundary, controls, mobile layout and preserved prompt/queue interface.
- Coordinator: dependencies, custom skill packaging/install, integration, browser verification, shared docs and deployment.
- Independent reviewer: reference capabilities, provenance, and skill behavior under a building-adaptation request.

The new renderer loads separately and retains the existing 2D simulator as a labeled fallback. The production server and physical-display integration boundary are unchanged.

## Reusable skill

[`skills/veyra-interactive-scenes`](../skills/veyra-interactive-scenes) packages the useful reproduction/adaptation distinctions, visual framing, transition contracts, 3D requirements and optional offline LTX workflow. The upstream repository contains no `SKILL.md`; this is an explicitly authored adaptation skill. It retains source links and the original MIT license notice.

No car images or video clips are used in the building application. New Three.js geometry is created for this project. Veyra's original art direction and interaction reference are credited to Amir Mušić; see [source provenance](https://github.com/amirmushichge/veyra-interactive-car/blob/v1.0.0/THIRD_PARTY_NOTICES.md). LTX is documented as a possible future media-production path and is not used for real-time window animation.
