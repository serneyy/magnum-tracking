# Magnum Tracking

Magnum is a Shopify-focused server-side tracking system built to maximize **truthful conversion matching** for Meta.

The main idea is simple: do not wait until the order exists and then try to guess where it came from. Preserve the customer's identity and ad-click context during the whole journey, connect that browser journey to Shopify's checkout, then connect the checkout to the final order.

Magnum will use a **third-party collector domain** such as:

```text
https://d.magnum.com
```

The collector does **not** need to live on `teenwear.eu`. However, the Shopify Web Pixel will still use Shopify's top-frame `browser.localStorage`, `browser.sessionStorage` and cookie APIs to preserve identifiers on the storefront when consent allows it.

> Important: `d.magnum.com` is the intended production pattern. We must only use a hostname/domain that we actually control before deployment.

---

## Primary objective

For every real Shopify order, Magnum should answer:

```text
Which browser visitor created this order?
Which Shopify clientId belonged to that visitor?
Which cart and checkout belonged to the visitor?
Was there a real Meta click?
Which fbclid / fbc / fbp were present?
Which customer match keys were available?
Which data was finally sent to Meta?
```

The success metric is not "send more Purchase events".

The success metric is:

```text
real Shopify order
        -> deterministic browser/checkout identity
        -> strongest legitimate Meta match payload
        -> one deduplicated Purchase event
```

---

# Architecture

```text
Shopify storefront / checkout
        |
        | Shopify Web Pixel
        |
        | HTTPS
        v
   d.magnum.com
        |
        v
Google Cloud HTTPS Load Balancer
        |
        v
Google Cloud Run: magnum-api
        |
        +--------------------+
        |                    |
        v                    v
Cloud SQL PostgreSQL      Pub/Sub
        |                    |
        |                    v
        |              magnum-worker
        |                    |
        |                    v
        |                 Meta CAPI
        |
        ^
        |
Shopify order webhook / Admin GraphQL
```

## Hosting

Magnum will run on Google Cloud Platform.

Recommended primary region:

```text
europe-west3 (Frankfurt)
```

Components:

- **Cloud Run** — collector/API and asynchronous workers
- **Cloud SQL PostgreSQL** — durable identity graph, events and deduplication state
- **Pub/Sub** — reliable outbound event queue and retries
- **Secret Manager** — Meta token, Shopify secrets and database credentials
- **Cloud Logging + Monitoring** — event failures, queue backlog, match quality and health checks

The application must remain stateless at the Cloud Run process level. Identity and deduplication must never depend on an in-memory `Map` or `Set` in production.

---

# The identity graph

Magnum's core is not Meta CAPI. The core is the identity graph.

A single customer journey can gradually accumulate these identifiers:

```text
mg_visitor_id
mg_session_id
Shopify clientId
Shopify cart id/token
Shopify checkout token
Shopify customer id
Shopify order id
email hash
phone hash
name/address hashes where permitted
fbclid
fbc
fbp
UTM data
landing URL
referrer
```

Example:

```text
mg_visitor_id:       mg_v_8d1...
shopify_client_id:  9c8...
cart_token:          abc...
checkout_token:      def...
customer_id:         gid://shopify/Customer/...
order_id:            gid://shopify/Order/...
fbc:                 fb.1.1787....AQ...
fbp:                 fb.1.1787....123...
```

These values are not interchangeable. They are independent evidence that the same journey belongs together.

---

# Matching priority

Magnum will prefer deterministic links and will not invent attribution.

## Level 1 — checkout token

This is the strongest commerce bridge.

Shopify Web Pixel exposes `checkout.token` during checkout events. Shopify Admin GraphQL exposes `Order.checkoutToken` on the final order.

```text
browser checkout_started
checkout.token = XYZ
        |
        v
Magnum stores XYZ -> visitor
        |
        v
Shopify order
Order.checkoutToken = XYZ
        |
        v
exact identity match
```

## Level 2 — cart token / cart id

Shopify also exposes cart identity and the Admin GraphQL Order object includes `cartToken` in API version 2026-07 and later.

This becomes a second deterministic bridge.

## Level 3 — Shopify clientId + Magnum visitor ID

Every Shopify Web Pixel event includes Shopify's `event.clientId`.

Magnum stores both:

```text
mg_visitor_id <-> shopify_client_id
```

This gives us another stable browser-side relationship across customer events.

## Level 4 — customer identifiers

When allowed and available, checkout can provide:

- email
- phone
- first name
- last name
- city
- province/state
- postal code
- country
- Shopify customer ID

Raw protected customer data should not be retained unnecessarily. The planned ingestion flow is:

```text
TLS request
   -> normalize on Magnum server
   -> SHA-256 where Meta requires hashing
   -> persist normalized hashes / minimum required data
   -> discard unnecessary raw values
```

The order webhook runs the same normalization so checkout identity can be linked to the final order.

## Level 5 — network context

The collector/API can capture the request IP and the Web Pixel provides browser user-agent context.

IP and user agent are useful Meta match keys, but Magnum must not use IP-only probabilistic matching to claim that an order came from a particular ad click.

---

# Meta click preservation

A Meta ad landing can contain:

```text
?fbclid=AQ...
```

Magnum captures the real `fbclid` immediately and preserves a matching `fbc` value.

Expected format:

```text
fb.1.<timestamp_in_milliseconds>.<fbclid>
```

Example:

```text
fb.1.1787875123456.AQ...
```

Rules:

1. Never fabricate `fbc` without a real `fbclid`.
2. Prefer an existing valid `_fbc` cookie when it represents the same click.
3. If a real `fbclid` is present and `_fbc` is not yet available, construct `fbc` once with the capture timestamp in **milliseconds**.
4. Preserve the exact value. Do not recreate it on every page because changing the timestamp creates different click identities for the same click.
5. Read `_fbp` when available and preserve the last known value as a fallback.
6. Do not hash `fbc` or `fbp`.

Magnum stores attribution as a **touchpoint history**, not only one mutable field.

Example:

```text
2026-08-27 13:40
Meta click A
campaign = Back To School
fbc = ...A

2026-08-28 18:10
Meta click B
campaign = Jeans
fbc = ...B

2026-08-28 18:31
Purchase
```

This lets Magnum understand which legitimate touch existed before the purchase instead of overwriting historical evidence blindly.

---

# First collector: Shopify Custom Pixel

The first executable collector is located at:

```text
shopify-pixel/magnum-custom-pixel.js
```

It is intentionally written as a **Shopify Custom Pixel** first because it can be installed and tested directly in Shopify Admin without building the full Shopify app extension first.

Later, after the data model is proven, it should be migrated into a proper Magnum Shopify App Pixel.

The collector subscribes only to an explicit allowlist of useful Shopify events:

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

For each allowed event it sends a normalized envelope containing:

```text
Magnum visitor ID
Magnum session ID
Shopify clientId
Shopify cart ID
Shopify customer ID when available
current / first / last attribution touch
fbclid / fbc / fbp when legitimately available
UTM parameters
page URL / referrer
Shopify event ID / sequence / timestamp
checkout token when available
minimum checkout match fields when available
product/cart context needed for later event generation
consent state
```

It does **not** forward Shopify's entire raw event object. Explicit normalization reduces accidental collection and prevents schema changes from silently adding unnecessary data.

---

# Consent model

Magnum will respect Shopify Customer Privacy state.

The first Meta-focused collector requires eligible analytics + marketing consent before it persists marketing identity or sends marketing-attribution data.

```text
analyticsProcessingAllowed = true
marketingAllowed = true
```

The pixel also listens for Shopify's `visitorConsentCollected` event so state can change during the session.

We will not build the product around bypassing a customer's reject decision.

---

# Browser collection vs Shopify server truth

Browser collection gives us attribution context.

Shopify server events give us purchase truth.

The final Purchase should therefore be based primarily on Shopify's order lifecycle, not on trusting only the browser success page.

```text
Browser
  -> captures fbclid/fbc/fbp + clientId + checkoutToken

Shopify
  -> confirms the actual order

Magnum
  -> joins both datasets
  -> creates final Purchase
  -> sends Meta CAPI
```

This is important because the browser can close, an ad blocker can stop the collector request, or the customer can complete checkout in a way where the browser event is unreliable.

A third-party `d.magnum.com` collector can also be blocked by some privacy/ad-blocking tools. That is a real tradeoff of not using a first-party collection hostname. The Shopify order webhook still protects purchase delivery, but blocked browser collection can reduce the amount of click identity available for matching.

---

# Purchase delivery and deduplication

Magnum will eventually support both:

```text
browser Purchase
server Purchase
```

When both are used, they must share the same deterministic Meta `event_id`.

Example:

```text
magnum_purchase_<shopify_order_id>
```

Then:

```text
browser Purchase  ----+
                     +--> Meta sees one Purchase
server Purchase   ----+
```

Server delivery is queued through Pub/Sub and stored in PostgreSQL before outbound delivery.

Temporary Meta errors use exponential retries. Permanent API validation errors move the event to a failed/dead-letter state for debugging instead of retrying forever.

---

# Magnum Match Score

Magnum will expose its own diagnostics for each order.

Example:

```text
ORDER #12345

Commerce identity
[OK] checkout token
[OK] cart token
[OK] Shopify clientId
[OK] Magnum visitor ID

Meta identity
[OK] real fbclid captured
[OK] fbc
[OK] fbp

Customer identity
[OK] email hash
[OK] phone hash
[OK] customer ID
[OK] postal/country match keys

Network
[OK] IP
[OK] user agent

Confidence: HIGH
```

The score is a diagnostic tool only. It must never be used to manufacture missing Meta attribution.

---

# Implementation plan

## Phase 0 — collector prototype

- [x] Define architecture
- [x] Define identity graph
- [x] Write first Shopify Custom Pixel collector
- [ ] Install collector in a test Shopify environment
- [ ] Inspect real payloads from Teenwear journeys

## Phase 1 — Magnum ingestion API

- [ ] `POST /v1/events`
- [ ] Validate schema and payload size
- [ ] Capture request IP server-side
- [ ] Normalize identifiers
- [ ] Persist visitor/session/event records
- [ ] CORS / abuse protection / rate limiting

## Phase 2 — PostgreSQL identity graph

Tables/models for:

```text
visitors
sessions
shopify_clients
carts
checkouts
customers
touchpoints
orders
identity_links
raw_ingest_events (short retention / optional)
outbound_events
delivery_attempts
```

Add unique indexes around deterministic identifiers such as checkout token and Shopify order ID.

## Phase 3 — Shopify order bridge

- [ ] Verified Shopify webhook ingestion
- [ ] Fetch/order enrichment through Admin GraphQL
- [ ] Read `Order.checkoutToken`
- [ ] Read `Order.cartToken`
- [ ] Read `Order.clientIp`
- [ ] Normalize customer match data
- [ ] Resolve order -> checkout -> visitor

## Phase 4 — Meta CAPI

- [ ] Build final `user_data`
- [ ] email / phone / name / geography normalization + hashing
- [ ] send raw `fbc`, `fbp`, IP and user-agent where appropriate
- [ ] deterministic event IDs
- [ ] queued delivery
- [ ] retries / dead-letter handling
- [ ] test event support

## Phase 5 — diagnostics

- [ ] Order debugger
- [ ] Match score
- [ ] Missing-signal reasons
- [ ] Meta response logging
- [ ] attribution/touchpoint timeline
- [ ] daily tracking-health metrics

## Phase 6 — production hardening

- [ ] move Custom Pixel into Magnum Shopify App Pixel
- [ ] protected customer data scopes
- [ ] retention rules
- [ ] encryption and key management
- [ ] deployment pipeline
- [ ] alerting
- [ ] load tests
- [ ] outage simulation

---

# What Magnum will not do

Magnum will not:

- create fake `fbclid` or `fbc`
- attach an old Meta click to an unrelated order merely to increase Ads Manager attribution
- use IP similarity alone to claim ad attribution
- intentionally create duplicate purchases
- persist customer marketing identifiers after a consent state says they should not be processed
- treat Meta's reported conversions as the source of truth for store revenue

Shopify remains the source of truth for orders. Magnum improves the quality of the evidence sent to Meta.

---

# Current repository status

The first server-side primitives live on the development branch and the first Shopify Custom Pixel collector lives in `shopify-pixel/`.

The next concrete engineering target is:

```text
Shopify Custom Pixel
       -> POST /v1/events
       -> PostgreSQL identity graph
       -> checkoutToken bridge
       -> Shopify order
       -> Meta CAPI Purchase
```
