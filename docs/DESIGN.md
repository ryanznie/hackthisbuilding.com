# Design direction

Purpose: a phone-friendly public artwork control surface. A passerby previews an idea, joins the queue, then looks up.

The current direction is an architectural scene inspired by the user's pinned Veyra reference: a blue-graphite atmosphere, ivory type, restrained scene frame and electric chartreuse interaction points. A large building visualization occupies roughly two-thirds of the desktop workspace, with a quiet composition panel beside it and the public queue beneath. The distinctive element is an orbitable Green Building with 153 animated windows driven by the same frames as the shared show.

Use Space Grotesk for headlines and body; IBM Plex Mono for technical labels and timing. Fine rules, light typography, softly rounded scene framing and restrained light glow keep the architecture central. Controls have at least 44px targets, with 48px scene interactions, visible focus and reduced-motion support. On phones show the framed building, then the prompt, personal status and queue. Display only actual queue state and label a renderer fallback explicitly.

Initial database design-system match suggested a generic hero/features pattern, which is off-target for this working tool; use the explicit product-specific direction above and the skill's accessibility guidance.
