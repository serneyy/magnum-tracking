# Magnum Tracking

**Magnum** is Teenwear's first-party + server-side tracking layer for Shopify, built to maximize the amount of **legitimate, matchable conversion data** sent to Meta while preserving deterministic attribution, deduplication, consent state and a complete internal audit trail.

The goal is not to make Meta report every Shopify order at any cost. The goal is to make sure that when an order really came from a Meta visit, Magnum preserves enough identity and click context from the first page view through checkout and order creation for Meta to match it reliably.

---

## What Magnum solves

Normal browser-only tracking loses signal when:

- cookies are restricted or cleared
- the user moves from product page to Shopify checkout
- `fbclid` disappears from the URL
- `_fbc` / `_fbp` are not available at purchase time
- the purchase browser event is blocked
- the browser closes before the event is delivered
- checkout happens on a different Shopify surface
- a server event has no link back to the original browser visit

Magnum solves this by building an **identity graph** during the full customer journey and then reconstructing the strongest truthful purchase payload once Shopify confirms the order.

---

# Production infrastructure

Magnum will run on **Google Cloud Platform**.

Primary region:

```text
europe-west3 (Frankfurt, Germany)
```

Reason:

- close to Teenwear's main EU traffic
- EU-hosted infrastructure
- managed autoscaling
- no single manually maintained VPS
- durable database and queue
- easy monitoring and secret management

## Public tracking endpoint

```text
https://track.teenwear.eu
```

The storefront will communicate with a Teenwear-owned first-party hostname rather than directly calling a random third-party tracking domain.

Planned DNS / request path:

```text
Browser / Shopify
      |
      | HTTPS
      v
track.teenwear.eu
      |
      v
Google Cloud External Application Load Balancer
      |
      v
Cloud Run: magnum-api
```

The load balancer terminates HTTPS and routes requests to a serverless Cloud Run backend.

---

# Google Cloud services

## 1. Cloud Run — `magnum-api`

Main stateless API service.

Responsibilities:

- receive browser identity updates
- receive browser event payloads
- receive Shopify webhooks
- verify Shopify webhook signatures
- normalize tracking data
- resolve visitor/cart/checkout/order identity
- write events to PostgreSQL
- enqueue outbound platform deliveries
- expose health endpoints
- expose protected internal debugging endpoints

Cloud Run is intentionally stateless. **No important identity or deduplication state may live only in RAM.**

---

## 2. Cloud SQL — PostgreSQL

PostgreSQL is Magnum's source of truth.

Planned logical tables:

```text
visitors
sessions
touchpoints
identifiers
carts
checkouts
customers
orders
order_items
consent_states
events
platform_deliveries
attribution_links
webhook_receipts
```

It stores mappings such as:

```text
visitor_id
   -> session_id
   -> fbclid / fbc / fbp
   -> cart_token
   -> checkout_token
   -> Shopify customer ID
   -> Shopify order ID
```

This mapping is the core of Magnum.

A purchase should never depend on an in-memory JavaScript `Map` or `Set` surviving a server restart.

---

## 3. Pub/Sub — durable event queue

Outbound delivery will be asynchronous.

Example flow:

```text
Shopify order webhook
        |
        v
    Magnum API
        |
        v
  PostgreSQL transaction
        |
        v
      Pub/Sub
        |
        v
Cloud Run: magnum-worker
        |
        v
      Meta CAPI
```

Why:

- Shopify webhook processing stays fast
- temporary Meta failures do not lose purchases
- delivery can retry safely
- traffic spikes do not overload the API
- failures can move to a dead-letter path for investigation

---

## 4. Cloud Run — `magnum-worker`

Background delivery worker.

Responsibilities:

- consume queued normalized events
- build platform-specific payloads
- send events to Meta CAPI
- record responses
- retry retryable failures
- prevent duplicate delivery
- move permanently failing events to dead-letter state

---

## 5. Secret Manager

Secrets must never be committed to GitHub.

Examples:

```text
META_ACCESS_TOKEN
META_PIXEL_ID
SHOPIFY_WEBHOOK_SECRET
DATABASE_URL / DB credentials
INTERNAL_ADMIN_SECRET
```

Cloud Run receives these through Secret Manager at runtime.

---

## 6. Cloud Logging + Monitoring

Magnum must be observable.

We should alert when:

- Shopify purchase webhooks stop arriving
- browser identify traffic drops suddenly
- Meta starts rejecting events
- queue backlog increases
- repeated delivery retries occur
- purchase match-data completeness falls
- duplicate events spike
- webhook signature verification fails repeatedly
- database connections/errors spike

Important dashboards:

```text
browser events / minute
Shopify orders / hour
Meta purchase sends / hour
Meta accepted / rejected
queue age
retry count
identity match completeness
fbc coverage
fbp coverage
email coverage
phone coverage
order -> visitor resolution rate
```

---

# Full customer tracking flow

## Step 1 — visitor lands on Teenwear

Example:

```text
https://www.teenwear.eu/products/example
  ?fbclid=IwZXh0...
  &utm_source=facebook
  &utm_medium=paid_social
  &utm_campaign=back_to_school
```

Once marketing tracking is allowed, Magnum creates or restores:

```text
visitor_id = mg_v_<uuid>
session_id = mg_s_<uuid>
```

The browser layer captures available context:

```text
landing_url
current_url
referrer
fbclid
fbc
fbp
utm_source
utm_medium
utm_campaign
utm_content
utm_term
timestamp
```

Magnum stores two attribution touchpoints:

```text
first_touch
last_touch
```

### First touch

The earliest eligible campaign/source touch known for the visitor.

It should remain stable.

### Last touch

The most recent eligible campaign/source touch.

It may update when a later campaign visit occurs.

---

# Meta click identifiers

## `fbclid`

Meta may append a click identifier to the landing URL.

Example:

```text
fbclid=IwZXh0bgNhZW0...
```

Magnum captures it immediately before it disappears during navigation or checkout.

## `fbc`

When appropriate, the Meta click context is represented using `_fbc` / `fbc`.

The important rule is:

> Magnum preserves real Meta click identifiers. It does not invent fake click IDs for orders that do not have one.

## `fbp`

Magnum captures the available Meta browser identifier and links it to the Magnum visitor identity.

At purchase time we want to be able to send Meta a payload containing, where legitimately available:

```text
fbc
fbp
hashed email
hashed phone
hashed external_id
client IP
user agent
```

The more valid matching fields we preserve, the better Meta's chance of matching the server purchase to the correct person/click.

---

# Step 2 — identity is persisted server-side

The browser sends an identity snapshot to:

```http
POST https://track.teenwear.eu/v1/identify
```

Logical example:

```json
{
  "visitor_id": "mg_v_123",
  "session_id": "mg_s_456",
  "cart_token": "cart_abc",
  "first_touch": {
    "fbclid": "IwZX...",
    "fbc": "fb.1....",
    "fbp": "fb.1....",
    "utm_source": "facebook",
    "utm_campaign": "back_to_school",
    "landing_url": "https://www.teenwear.eu/..."
  },
  "last_touch": {
    "utm_source": "facebook",
    "utm_campaign": "back_to_school"
  }
}
```

The API writes/merges this state into PostgreSQL.

---

# Step 3 — Shopify Web Pixel captures storefront events

The Shopify Web Pixel / browser SDK should subscribe to relevant Shopify customer events.

Initial event set:

```text
page_viewed
product_viewed
collection_viewed
search_submitted
product_added_to_cart
cart_viewed
checkout_started
checkout_contact_info_submitted
checkout_address_info_submitted
payment_info_submitted
checkout_completed
```

Magnum normalizes these into internal events such as:

```text
PageView
ViewContent
Search
AddToCart
InitiateCheckout
AddPaymentInfo
Purchase
```

Not every browser event needs to be sent immediately to Meta server-side. The first priority is to preserve identity and funnel context reliably.

---

# Step 4 — cart identity bridge

As soon as Shopify exposes a cart identifier/token, Magnum links it to the visitor.

```text
visitor_id
    |
    +--> cart_token
```

Example database relationship:

```text
mg_v_123 -> cart_abc
```

This matters because the cart identifier can survive deeper into Shopify's checkout journey even when the original landing URL no longer exists.

---

# Step 5 — checkout identity bridge

When checkout begins, Magnum attempts to link:

```text
visitor_id
cart_token
checkout_token / checkout identity
```

Result:

```text
visitor
  -> session
  -> click
  -> cart
  -> checkout
```

If checkout later provides eligible customer information, Magnum can add:

```text
email
phone
Shopify customer ID
```

Sensitive matching data should be normalized and hashed as required before platform delivery.

---

# Step 6 — Shopify confirms the order server-side

The browser Purchase event is useful, but it must not be the only source of truth.

Shopify sends a signed order webhook to Magnum.

Example endpoint:

```http
POST https://track.teenwear.eu/webhooks/shopify/orders/create
```

Magnum verifies the Shopify HMAC signature before accepting the payload.

The order webhook gives us authoritative server-side order data such as:

```text
order ID
order number
checkout reference
customer ID
email
phone
currency
total price
tax
shipping
line items
created_at
```

The exact fields depend on the Shopify webhook/API payload available to the integration.

---

# Step 7 — Magnum reconstructs the order identity

The resolver attempts to join the order back to the browser journey using the strongest available mappings.

Conceptually:

```text
Shopify order
     |
     +-- checkout token/reference
     |
     +-- cart token/reference
     |
     +-- customer ID
     |
     +-- normalized email
     |
     +-- normalized phone
     v
Magnum visitor identity
     |
     +-- fbc
     +-- fbp
     +-- Meta click
     +-- first touch
     +-- last touch
     +-- session
     +-- landing page
     +-- browser context
```

The resolver must record **why** a match was made.

Example:

```text
order #12345
visitor: mg_v_123
resolution method: checkout_token
confidence: deterministic
```

or:

```text
order #12346
visitor: mg_v_789
resolution method: normalized_email + recent checkout
confidence: secondary
```

We should avoid weak guessing that could incorrectly attach an order to the wrong click.

---

# Step 8 — build the Meta Purchase payload

A normalized Purchase event is created.

Example conceptual payload:

```json
{
  "event_name": "Purchase",
  "event_time": 1787870000,
  "event_id": "purchase_<deterministic-order-id>",
  "action_source": "website",
  "event_source_url": "https://www.teenwear.eu/...",
  "user_data": {
    "em": ["<sha256>"],
    "ph": ["<sha256>"],
    "external_id": ["<sha256>"],
    "fbc": "fb.1....",
    "fbp": "fb.1....",
    "client_ip_address": "...",
    "client_user_agent": "..."
  },
  "custom_data": {
    "currency": "EUR",
    "value": 69.95,
    "order_id": "12345",
    "content_type": "product",
    "contents": []
  }
}
```

Only fields legitimately available for that order are included.

---

# Purchase value strategy

Magnum should make the value sent to Meta configurable.

Modes planned:

```text
GROSS
NET_OF_TAX
NET_OF_TAX_AND_SHIPPING
CUSTOM
```

For Teenwear the expected preferred mode is:

```text
NET_OF_TAX
```

This avoids Meta reporting artificially inflated ROAS when VAT is not considered revenue internally.

The Shopify order itself remains stored with full original monetary components so the calculation can be audited.

---

# Browser + server deduplication

If both the browser pixel and Magnum server send the same conversion, they must use the **same deterministic event ID**.

Example:

```text
browser Purchase event_id = purchase_12345
server  Purchase event_id = purchase_12345
```

Meta can then deduplicate the two copies rather than count two purchases.

Magnum also keeps its own idempotency key in PostgreSQL.

A unique constraint should prevent:

```text
platform = meta
event_name = Purchase
order_id = 12345
```

from being delivered as multiple independent purchases.

---

# Delivery and retry behavior

A Shopify order is never considered "sent" merely because Magnum attempted an HTTP request.

Delivery states:

```text
pending
queued
sending
accepted
retrying
failed
dead_letter
```

Example:

```text
Purchase stored in PostgreSQL
        |
        v
Pub/Sub message
        |
        v
Meta request
   /          \
200 OK       timeout / 5xx / retryable error
  |                    |
accepted               v
                    retry queue
                        |
                        v
                    try again
```

Retries must use the same `event_id`.

A retry must never become a new purchase.

---

# Consent behavior

Magnum is designed to improve tracking quality **without deliberately bypassing consent requirements**.

The browser layer should read Shopify Customer Privacy / consent state before using marketing tracking identifiers that require consent.

Conceptual states:

```text
unknown
allowed
denied
```

When marketing tracking is denied, Magnum should not secretly emulate a marketing cookie system simply to improve attribution.

Server-side order processing required for store operations can still exist separately, but sending customer data to advertising platforms must follow the configured legal/consent policy.

The consent state used for a tracking decision should be stored with the event for auditability.

---

# Internal attribution debugger

One of Magnum's most important features will be the ability to inspect a specific Shopify order and understand exactly what happened.

Example internal view:

```text
Order: #12345
Shopify order ID: 987654321
Created: 2026-08-28 14:12:03 UTC

IDENTITY
Visitor: mg_v_123
Session: mg_s_456
Cart: cart_abc
Checkout: chk_xyz
Customer: 456789

META SIGNALS
fbclid: present
fbc: present
fbp: present
email: present
phone: present
IP: present
user agent: present

ATTRIBUTION
First touch: facebook / paid_social / back_to_school
Last touch: facebook / paid_social / retargeting
Resolution: checkout_token

META DELIVERY
Event ID: purchase_12345
Status: accepted
Attempts: 1
Response ID: ...
```

This is how we stop guessing why Meta did or did not attribute an order.

---

# Match completeness score

Magnum should calculate an internal diagnostics score for each purchase.

This is **not** Meta's official EMQ score. It is Magnum's own visibility metric.

Example:

```text
fbc           yes
fbp           yes
email         yes
phone         yes
external_id   yes
IP            yes
user_agent    yes
--------------
identity completeness: strong
```

Dashboard metrics should show percentages such as:

```text
Purchase with fbc:        62%
Purchase with fbp:        91%
Purchase with email:     100%
Purchase with phone:      84%
Order resolved to visitor: 93%
```

This lets us identify the actual weak point instead of blindly changing tracking providers.

---

# Event timestamp policy

Purchase `event_time` should represent the real conversion time as closely as possible, not simply the time a retry worker happens to send the event.

Store:

```text
occurred_at
received_at
queued_at
sent_at
```

If Meta is temporarily unavailable, a later retry keeps the original occurrence timestamp where platform rules allow it.

---

# Refunds and order changes

Magnum should store Shopify refunds, cancellations and relevant order updates internally.

Planned webhook coverage:

```text
orders/create
orders/updated
orders/cancelled
refunds/create
```

Whether and how these are sent to advertising platforms is handled separately per platform capability and reporting strategy.

The internal database should always preserve the true Shopify order state.

---

# Security

Required controls:

- HTTPS only
- Shopify webhook HMAC verification
- rate limiting on public ingestion routes
- strict request schemas
- maximum payload limits
- no Meta access token in client JavaScript
- no Shopify secret in client JavaScript
- secrets stored in Secret Manager
- admin/debug routes protected separately
- database not publicly exposed
- parameterized SQL / ORM
- structured audit logging
- minimize stored personal data
- retention policy for raw identifiers

---

# Failure scenarios

## Browser tracking fails

The Shopify server-side order webhook can still create the order record.

Identity quality may be weaker, but the conversion is not silently lost from Magnum's internal order pipeline.

## Meta API is down

The event remains queued and retries later with the same event ID.

## Magnum API instance restarts

No important state is lost because Cloud Run is stateless and identity/dedupe state is stored in PostgreSQL.

## Pub/Sub delivers the same message twice

The worker uses database idempotency and the same deterministic event ID, so duplicate queue delivery does not become a duplicate purchase.

## Shopify sends the same webhook twice

Webhook/event uniqueness is checked before creating another logical order event.

## `fbclid` disappeared before checkout

If captured legitimately during the landing session, the visitor identity already preserves the related click context server-side.

---

# Planned API surface

```text
GET  /health
POST /v1/identify
POST /v1/events
POST /v1/purchase

POST /webhooks/shopify/orders/create
POST /webhooks/shopify/orders/updated
POST /webhooks/shopify/orders/cancelled
POST /webhooks/shopify/refunds/create

GET  /internal/orders/:id/attribution
GET  /internal/events/:eventId
```

Public and internal endpoints will use different authorization rules.

---

# Planned repository structure

```text
src/
  browser/
    pixel.ts
    identity.ts
    consent.ts
    attribution.ts

  server/
    api.ts
    webhooks/
      shopify.ts
    routes/
      identify.ts
      events.ts

  core/
    identity.ts
    attribution.ts
    events.ts
    hashing.ts
    money.ts

  platforms/
    meta/
      capi.ts
      payload.ts
      dedupe.ts

  workers/
    delivery.ts

  db/
    schema.ts
    queries.ts

  observability/
    logging.ts
    metrics.ts
```

---

# Deployment environments

## Development

Local machine / local PostgreSQL where required.

## Staging

```text
staging-track.teenwear.eu
```

Uses Meta Test Events and separate staging secrets/database.

No production Pixel dataset should be polluted during integration testing.

## Production

```text
track.teenwear.eu
```

Production Cloud Run, PostgreSQL, Pub/Sub and Meta credentials.

---

# Deployment flow

Planned flow:

```text
GitHub
  |
  v
GitHub Actions
  |
  +--> tests
  +--> typecheck
  +--> build container
  |
  v
Google Artifact Registry
  |
  v
Cloud Run deploy
```

Database migrations must run as an explicit controlled deployment step.

---

# Development phases

## Phase 1 — Core tracking engine

- [x] repository initialization
- [x] visitor/session identity primitives
- [x] first/last touch model
- [x] fbclid/fbc/fbp handling primitives
- [x] normalized Meta user data
- [x] deterministic event IDs
- [x] basic Meta CAPI sender
- [x] initial browser identify layer
- [ ] production database persistence

## Phase 2 — Shopify identity bridge

- [ ] Shopify Web Pixel
- [ ] Shopify consent integration
- [ ] cart token mapping
- [ ] checkout mapping
- [ ] checkout/customer identity enrichment
- [ ] signed Shopify order webhooks
- [ ] order-to-visitor resolver

## Phase 3 — Durable production delivery

- [ ] PostgreSQL schema + migrations
- [ ] Pub/Sub topics/subscriptions
- [ ] Cloud Run delivery worker
- [ ] retry rules
- [ ] dead-letter handling
- [ ] database idempotency

## Phase 4 — Attribution diagnostics

- [ ] per-order identity report
- [ ] matching-field coverage metrics
- [ ] first-touch / last-touch debugger
- [ ] Meta response history
- [ ] failed-event replay
- [ ] internal dashboard/API

## Phase 5 — Production rollout

- [ ] Google Cloud project configuration
- [ ] Frankfurt deployment
- [ ] `track.teenwear.eu` DNS
- [ ] TLS
- [ ] staging integration test
- [ ] Meta Test Events validation
- [ ] Shopify webhook validation
- [ ] controlled production shadow test
- [ ] compare Magnum vs existing tracking
- [ ] production cutover only after data validation

---

# The core rule

Magnum should optimize **signal quality, persistence and truthfulness**, not manufacture attribution.

The system wins if it can answer this for every purchase:

```text
Where did this order come from?
Which visitor/session/cart/checkout produced it?
Which legitimate Meta identifiers did we preserve?
Exactly what did we send to Meta?
Did Meta accept it?
Was it retried or deduplicated?
```

If Magnum can answer those questions reliably, we no longer have to blindly trust a black-box tracking app.