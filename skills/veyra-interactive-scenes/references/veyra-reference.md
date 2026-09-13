# Pinned source and adaptation notes

- Author: Amir Mušić.
- Repository: https://github.com/amirmushichge/veyra-interactive-car
- Release: https://github.com/amirmushichge/veyra-interactive-car/releases/tag/v1.0.0
- Commit: `5779ec0762559b84bd5da3b6ffccf76e747f7587`.
- Reproduction guide: https://github.com/amirmushichge/veyra-interactive-car/blob/v1.0.0/docs/RECREATE.md
- Architecture: https://github.com/amirmushichge/veyra-interactive-car/blob/v1.0.0/docs/ARCHITECTURE.md
- Media: https://github.com/amirmushichge/veyra-interactive-car/blob/v1.0.0/docs/MEDIA.md
- Verification: https://github.com/amirmushichge/veyra-interactive-car/blob/v1.0.0/docs/VERIFICATION.md
- Screenshots: `docs/images/desktop.png` and `docs/images/mobile.png` at that release.

The visual reference uses Space Grotesk 400, a blue studio background, white frame and text, and electric-green interaction points. The object shares a stable coordinate plane with its hotspots. Menus occupy supporting space rather than covering the object. These are useful principles for adaptations; the precise car assets, colors and text are constraints only for exact restoration.

The release consists of React, TypeScript and Vite with authored stills and four short forward/reverse films. It does not ship a 3D mesh or runtime 3D camera. Detail views zoom/crossfade into stills; dormant flight-clip metadata is not an implemented feature. The authored hover films were generated with Kling through Pika and finished in After Effects. LTX is a separate optional future-media workflow.

The hover state machine holds the last decoded frame at handoff, tracks desired versus settled targets and reverses through authored endpoints. Appearance controls wait for a neutral pose and lock competing interactions during transitions. The exact reference documents a focus race during appearance closing; an adaptation can fix it within the user's task scope, while exact restoration should identify any deliberate behavior change.

Code and documentation are MIT licensed. The author offers bundled media under MIT to the extent of the author's rights; trademarks and third-party likeness rights are not conferred. See the retained [upstream license](VEYRA-LICENSE.txt) and [provenance notice](https://github.com/amirmushichge/veyra-interactive-car/blob/v1.0.0/THIRD_PARTY_NOTICES.md). Do not describe new geometry or newly generated imagery as the original authored media.
