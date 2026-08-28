# Magnum Tracking

Magnum is a privacy-aware first-party/server-side tracking system for Shopify focused on reliable identity stitching and high-quality Meta Conversions API events.

## Core principles

- First-party visitor/session identity with consent-aware persistence
- Capture and preserve `fbclid`/`fbc`, `_fbp`, UTM and landing/referrer context
- Stitch browser identity to cart, checkout and Shopify order identifiers
- Send normalized server-side events to Meta CAPI with strong `user_data`
- Deterministic event IDs and idempotency to prevent duplicate purchases
- Never bypass customer consent requirements

Development happens on feature branches and is reviewed before merging.
