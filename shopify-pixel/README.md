# Magnum Shopify Pixel

This directory contains the first browser-side collector for Magnum.

## File

```text
magnum-custom-pixel.js
```

It is written for **Shopify Custom Pixels** so the tracking model can be tested before Magnum becomes a full Shopify app/web-pixel extension.

## Installation target

```text
Shopify Admin
-> Settings
-> Customer events
-> Add custom pixel
```

Paste the contents of `magnum-custom-pixel.js` into the custom pixel editor.

Do not enable it in production until the Magnum collector API exists and `MAGNUM.COLLECTOR_URL` points to a domain controlled by us.

---

## Why start with a Custom Pixel?

Shopify Custom Pixels expose the same important Standard API concepts we need for the prototype:

- `analytics.subscribe(...)`
- `browser.cookie`
- `browser.localStorage`
- `browser.sessionStorage`
- `init`
- `customerPrivacy`
- Shopify standard customer events

This lets us validate real Teenwear journeys before investing time in packaging Magnum as a Shopify app extension.

The long-term production version should become an **App Pixel** so installation, configuration, protected customer-data scopes and merchant onboarding can be managed properly.

---

# What the collector captures

## Magnum identity

```text
mg_visitor_id
mg_session_id
```

`mg_visitor_id` is persisted through Shopify's top-frame local-storage bridge.

`mg_session_id` is persisted through Shopify's top-frame session-storage bridge.

## Shopify identity

Every collected standard event can include:

```text
Shopify event.clientId
Shopify event.id
Shopify event.seq
Shopify event.timestamp
cart id
checkout token
Shopify customer id where available
Shopify order id at checkout completion where available
```

The most important field is the **checkout token**. The final Shopify Admin GraphQL Order also exposes `checkoutToken`, allowing a deterministic browser-checkout-to-order join.

## Meta click identity

The collector attempts to preserve:

```text
fbclid
_fbc / fbc
_fbp / fbp
```

Rules:

- a new `fbc` is created only when a real `fbclid` exists
- the timestamp is stored in milliseconds
- once an `fbc` is created for a specific click, Magnum freezes it instead of generating a new timestamp on every event
- the existing Meta `_fbc` cookie is preferred when it belongs to the current `fbclid`
- the last known `_fbp` value is retained as a fallback after consent
- `fbc` and `fbp` are not hashed

## Campaign context

```text
utm_source
utm_medium
utm_campaign
utm_content
utm_term
landing URL
referrer
```

Magnum preserves both `first` and `last` touch state and sends the current touch to the backend. The backend will eventually keep full touchpoint history.

## Checkout match data

When Shopify provides protected checkout fields, the collector sends only the fields we actually need for identity matching:

```text
email
phone
first name
last name
city
province/state
postal code
country
```

Street address is intentionally omitted from the prototype.

The backend design is to normalize/hash these values immediately and avoid long-term storage of unnecessary raw PII.

---

# Event allowlist

The first prototype subscribes to:

```text
page_viewed
product_viewed
product_added_to_cart
cart_viewed
checkout_started
checkout_contact_info_submitted
checkout_address_info_submitted
checkout_shipping_info_submitted
payment_info_submitted
checkout_completed
```

We intentionally do **not** use `all_events` because silently forwarding every future Shopify event would make the schema unstable and could collect data we never intended to collect.

---

# Consent

The Meta-focused prototype requires both:

```text
analyticsProcessingAllowed === true
marketingAllowed === true
```

The pixel also listens to Shopify's `visitorConsentCollected` privacy event so the in-session state can update.

No persistent Magnum marketing ID or outbound attribution payload should be created when the required consent is not available.

---

# Payload shape

Example logical envelope:

```json
{
  "schema_version": 1,
  "source": "shopify_custom_pixel",
  "pixel_version": "0.1.0",
  "sent_at": "2026-08-28T01:00:00.000Z",
  "consent": {
    "analytics_processing_allowed": true,
    "marketing_allowed": true
  },
  "identity": {
    "mg_visitor_id": "mg_v_...",
    "mg_session_id": "mg_s_...",
    "shopify_client_id": "...",
    "cart_id": "...",
    "checkout_token": "..."
  },
  "meta": {
    "fbclid": "AQ...",
    "fbc": "fb.1.1787875123456.AQ...",
    "fbp": "fb.1.1787875000000.123456789"
  },
  "attribution": {
    "current": {},
    "first": {},
    "last": {},
    "has_new_attribution": true
  },
  "event": {
    "name": "checkout_started",
    "shopify_event_id": "...",
    "seq": 5,
    "timestamp": "...",
    "url": "...",
    "user_agent": "...",
    "checkout": {
      "checkout_token": "..."
    }
  }
}
```

The receiving API should use the HTTP request itself to capture source IP. The browser payload does not attempt to discover the public IP.

---

# What happens next

The next backend endpoint is:

```text
POST /v1/events
```

Its job will be:

1. validate the envelope
2. reject malformed/oversized traffic
3. capture request IP
4. normalize identifiers
5. normalize/hash protected customer fields
6. upsert visitor/session/client/cart/checkout identities
7. append a touchpoint when a new campaign signal exists
8. store the Shopify event id for idempotency
9. return quickly

It should **not** call Meta synchronously for every browser request.

The final Purchase is generated later from the verified Shopify order and joined back to this identity graph using `checkoutToken`, `cartToken` and other deterministic evidence.

---

# Known tradeoff of d.magnum.com

A third-party collector domain is operationally clean and reusable across merchants, but it can be blocked by some browser privacy tools and ad blockers more often than a first-party merchant hostname.

That means:

```text
third-party collector blocked
        -> some browser attribution context may be lost
        -> Shopify order webhook still confirms the purchase
        -> server Purchase can still be delivered
        -> Meta match quality may be weaker for that order
```

Magnum should measure this loss rate instead of pretending it does not exist.

If real production data later shows meaningful blocking, a first-party proxy can remain an optional deployment mode without changing the identity model.
