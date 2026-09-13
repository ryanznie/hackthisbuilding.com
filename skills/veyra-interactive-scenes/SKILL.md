---
name: veyra-interactive-scenes
description: Build polished interactive object or architectural scenes using Veyra's composition and transition methods. Use for Veyra-inspired mockups, product explorations, hotspot interfaces, and adaptations to live 3D; also supports exact restoration of the pinned Veyra release when explicitly requested.
---

# Veyra Interactive Scenes

Use the pinned [Veyra v1.0.0 reference](references/veyra-reference.md) for visual composition and interaction continuity. The upstream repository is an application, not an installable skill; this skill extracts its reusable method. Credit Amir Mušić when sharing a design adaptation and retain the upstream license for copied code, media, or documentation.

## Choose the requested outcome

- **Exact restoration:** obtain the v1.0.0 release, inspect its desktop and mobile screenshots, and follow the upstream `docs/RECREATE.md`. Preserve approved source/media bytes, pinned dependencies and state behavior. Run its reference verifier without regenerating the manifest to conceal changes.
- **Adaptation:** preserve the user's subject, existing working product, and desired behavior. Extract composition, focus, loading and transition principles; write the new subject's interactions. Identify the result as an adaptation, not an exact reproduction.
- **Live 3D:** Veyra contains no runtime 3D model. Use real geometry and a rendering engine when the user needs orbit, perspective, dynamic lights, arbitrary camera angles, or real-time data. Authored films are appropriate for fixed choreographed reveals. Do not label a still image or prerecorded sequence as an orbitable 3D model.

## Composition

Make the object or building the main visual. Align the header, title, scene frame and controls to one measured width. Use restrained typography, a thin visible scene frame, a coherent background and one strong interaction accent. Keep control panels outside the important silhouette. On narrow screens, stack supporting controls without shrinking the subject to an unreadable thumbnail.

Attach hotspots to the image plane or project them from world coordinates; avoid positions that drift with unrelated screen dimensions. Provide approximately 48px targets, keyboard focus, selected states and a clear return/reset action. Prefer a few meaningful interactions over decorative hotspots.

## Continuity

Separate the requested target from the currently displayed state. Rapid interaction should update the desired destination, not start competing transitions. Keep the last valid visible frame until the next media frame is decoded or the 3D renderer has produced its first frame. Do not clear to black between states.

For media reveals, finish compatible authored endpoints before reversing or switching systems. Gate alternate appearances on a neutral pose. For live 3D, smoothly move the camera and target together, cancel camera transitions when the user takes control, and keep the object's scale/framing stable across UI changes.

Load heavy renderers separately. Bound pixel ratio and geometry/material counts for phones, dispose GPU resources and event listeners on unmount, and provide an honest fallback if WebGL is unavailable. Respect reduced motion without disabling core interactions.

## Real-time preview integration

Use the same deterministic scene/frame definition for private preview and shared playback. Keep prompt approval, queue admission and shared time on the server. Camera movement and presentation controls must not change the approved animation. Preserve working APIs when replacing a renderer.

## Optional generated media

Read [the LTX workflow notes](references/ltx-workflow.md) only when new prerecorded media is requested. LTX is optional, is not the provenance of Veyra's bundled hover films, and is not needed for a geometry-based live preview. Confirm current provider schema and pricing before use. Keep keys server-side or in an ignored local environment file; do not put them into frontend variables.

## Verify the experience

Inspect the actual browser at desktop and phone sizes. Exercise camera/reset controls, rapid state changes, keyboard paths, loading/failure recovery and the real application workflow. Check the subject remains fully framed, controls stay reachable, and a renderer failure does not break the prompt or queue. Use focused tests for state and mapping invariants; report physical-device or provider checks that were not performed.
