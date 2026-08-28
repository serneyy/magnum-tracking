# Magnum Tracking

Magnum is a privacy-aware first-party and server-side tracking system for Shopify focused on reliable identity stitching and high-quality Meta Conversions API events.

The goal is not to invent attribution or force every Shopify order into Meta. The goal is to preserve as many legitimate identifiers as possible from the first eligible visit through checkout and order creation, then send Meta the strongest truthful event payload we can build.

## Core principles

- First-party visitor/session identity with consent-aware persistence
- Capture and preserve `fbclid` / `fbc`, `_fbp`, UTM and landing/referrer context
- Stitch browser identity to cart, checkout, Shopify customer and Shopify order identifiers
- Send normalized server-side events to Meta CAPI with strong `user_data`
- Use the same deterministic event ID across browser/server where deduplication is required
- Durable queues, retries and idempotency so temporary outages do not lose purchases
- Keep an internal attribution trail for debugging every order
- Never bypass customer consent requirements

---

# Production architecture

Magnum will run on **Google Cloud Platform**.

We are deliberately choosing managed Google Cloud infrastructure instead of running a permanent VPS. Tracking is too important to depend on one manually maintained server process.

## Main infrastructure

### Public first-party endpoint

`https://track.teenwear.eu`

This will be the public first-party tracking hostname used by the Teenwear storefront and Shopify integrations.

Traffic flow:

```text
Customer browser
      |
      | HTTPS
      v
track.teenwear.eu
      |
      v
Google Cloud HTTPS Load Balancer
      |
      v
Google Cloud Run - Magnum API
```

Using a Teenwear subdomain gives us a stable first-party endpoint instead of sending storefront traffic directly to a random third-party tracking domain.

### Google Cloud Run

Cloud Run will host the Magnum API and workers.

Primary service:

```text
magnum-api
```

Responsibilities:

- receive browser identity/touchpoint updates
- receive browser events
- receive Shopify webhooks
- verify incoming webhook signatures
- look up and stitch identities
- create normalized tracking events
- enqueue delivery jobs
- expose internal health/debug endpoints

Cloud Run is stateless. Important state must never live only in process memory.

### Cloud SQL for PostgreSQL

PostgreSQL is Magnum's source of truth.

It stores:

- visitors
- sessions
- touchpoints
- click IDs
- cart mappings
- checkout mappings
- customer mappings
- Shopify orders
- event IDs
- outbound Meta events
- delivery status
- retry state
- consent state
- attribution/debug history

No production identity or deduplication logic should depend on an in-memory JavaScript `Map` or `Set`.

### Google Pub/Sub

Pub/Sub will separate event ingestion from outbound delivery.

Example:

```text
Shopify order webhook
        |
        v
     Magnum API
        |
        | transaction committed
        v
   PostgreSQL
        |
        v
     Pub/Sub
        |
        v
 Magnum delivery worker
        |
        v
      Meta CAPI
```

This means a temporary Meta outage or API timeout does not cause us to lose the purchase event.

### Google Secret Manager

Secrets will not be stored in GitHub or hardcoded in source code.

Secret Manager will contain values such as:

- Meta CAPI access token
- Shopify webhook/app secret
- database credentials where applicable
- internal API secrets

### Google Cloud Logging / Monitoring

Every important tracking step should generate structured logs and metrics.

We want to know immediately when:

- Shopify webhooks stop arriving
- browser identify traffic drops unexpectedly
- Meta starts rejecting events
- queue backlog grows
- purchase events are retrying repeatedly
- average match-data completeness falls
- duplicate prevention starts triggering abnormally often

---

# Full tracking flow

## 1. Customer lands on Teenwear

Example landing URL:

```text
https://www.teenwear.eu/products/example?fbclid=ABC123&utm_source=facebook&utm_campaign=bts
```

After the required tracking consent is available, the Magnum browser SDK / Shopify Web Pixel creates or restores:

```text
visitor_id = mg_v_<uuid>
session_id = mg_s_<uuid>
```

It captures eligible attribution context such as:

```text
landing_url
referrer
fbclid
fbc
_fbp
utm_source
utm_medium
utm_campaign
utm_content
utm_term
timestamp
```

For a valid Meta click ID Magnum can preserve the click and associated `fbc` rather than relying on the value still being present later during checkout.

Two touchpoints are maintained:

```text
first_touch
last_touch
```

`first_touch` is intentionally stable once captured.

`last_touch` may update when a later eligible campaign touch occurs.

## 2. Browser sends the identity to Magnum

The storefront sends a request to:

```text
POST https://track.teenwear.eu/v1/identify
```

Example logical payload:

```json
{
  "visitor_id": "mg_v_...",
  "session_id": "mg_s_...",
  "cart_token": "...",
  "first_touch": {
    "fbclid": "...",
    "fbc": "...",
    "fbp": "...",
    "utm_source": "facebook",
    "utm_campaign": "bts"
  },
  "last_touch": {
    "fbclid": "...",
    "fbc": "...",
    "fbp": "..."
  }
}
```

The API writes or updates the identity graph in PostgreSQL.

## 3. Magnum tracks the Shopify storefront journey

The Shopify Web Pixel layer will subscribe to supported customer events such as:

```text
page_viewed
product_viewed
product_added_to_cart
cart_viewed
checkout_started
checkout_contact_info_submitted
checkout_shipping_info_submitted
payment_info_submitted
checkout_completed
```

These are normalized internally into Magnum events such as:

```text
PageView
ViewContent
AddToCart
InitiateCheckout
AddPaymentInfo
Purchase
```

Not every browser event must be delivered directly to Meta immediately. Magnum can ingest it first, normalize it, deduplicate it and then decide whether it is eligible for delivery.

## 4. Visitor identity is attached to the cart

One of the most important parts of Magnum is carrying the browser identity beyond the original page visit.

Where Shopify allows it, Magnum will associate:

```text
visitor_id
session_id
cart_token
```

with the active Shopify cart.

The database can then resolve:

```text
visitor
   -> session
   -> cart
   -> checkout
   -> order
```

This is much stronger than trying to reconstruct the entire journey only after the order already exists.

## 5. Checkout starts

When checkout begins, Magnum records or resolves the checkout identifier and links it to the existing visitor/cart graph.

Conceptually:

```text
mg_v_123
   |
   +-- session: mg_s_456
   |
   +-- cart: cart_789
   |
   +-- checkout: checkout_abc
```

If customer information becomes available through an approved Shopify event or server-side Shopify payload, Magnum can progressively enrich the identity.

Possible fields include:

```text
Shopify customer ID
email
phone
country
city
postal code
first name
last name
```

Fields intended for Meta Advanced Matching/CAPI are normalized according to Meta requirements and hashed before being sent where hashing is required.

Raw customer data must not be written unnecessarily into application logs.

## 6. Shopify creates the order

The browser's `checkout_completed` event is useful, but Magnum must not depend exclusively on a browser thank-you page event.

Shopify server-side order webhooks are the authoritative fallback/source for completed orders.

Example:

```text
Shopify
   |
   | orders/create or equivalent configured order event
   v
POST track.teenwear.eu/webhooks/shopify/order
   |
   v
Magnum API
```

Magnum verifies the Shopify webhook signature before accepting the event.

The order is stored before any Meta delivery is attempted.

## 7. Order identity reconstruction

When an order arrives, Magnum tries to connect it to the strongest known identity graph.

Possible joins include:

```text
checkout token
cart token
visitor ID carried through the journey
Shopify customer ID
normalized email
normalized phone
known session/order metadata
```

Once a match is found, Magnum can recover earlier marketing context such as:

```text
fbc
fbp
fbclid
first landing URL
last landing URL
UTMs
referrer
browser user agent
eligible client IP captured at event time
```

The goal is that the order webhook does not need to contain `fbclid` itself. Magnum should already know which eligible browser identity eventually produced that order.

## 8. Magnum creates the Purchase event

A deterministic Purchase event ID is created from the Shopify order identity.

For example conceptually:

```text
SHA256("purchase|<shopify-order-id>")
```

The same logical Shopify purchase must always resolve to the same Magnum event ID.

This gives us idempotency across:

- duplicate Shopify webhooks
- API retries
- Cloud Run restarts
- Pub/Sub redelivery
- manual reprocessing

The database has a unique constraint around the logical event identity so a second worker cannot create a second purchase accidentally.

## 9. Event goes into the delivery queue

The API does **not** make successful order ingestion depend on Meta being online.

Instead:

```text
Order received
      |
      v
PostgreSQL transaction
      |
      +-- store/update order
      +-- create Purchase event
      +-- store attribution snapshot
      |
      v
Publish delivery job
      |
      v
Google Pub/Sub
```

## 10. Worker sends the event to Meta CAPI

The delivery worker builds the final Meta payload.

Potential `user_data` includes, when legitimately available:

```text
em
ph
external_id
fbc
fbp
client_ip_address
client_user_agent
fn
ln
ct
st
zp
country
```

Purchase `custom_data` can include:

```text
currency
value
order_id
content_ids
contents
content_type
```

Magnum stores Meta's response and delivery timestamp.

## 11. Failed Meta requests are retried

Retryable failures are not discarded.

Example policy:

```text
attempt 1 -> immediate
attempt 2 -> short backoff
attempt 3 -> longer backoff
attempt 4+ -> exponential backoff
```

Permanent validation errors go to a failed/dead-letter state for inspection rather than retrying forever.

We should be able to replay eligible failed events after fixing a configuration problem without generating duplicate purchases.

---

# Browser + server deduplication

Where we intentionally send the same event through both browser Meta Pixel and server Meta CAPI, both sides must use the same logical `event_id`.

Example:

```text
Browser Purchase
  event_name = Purchase
  event_id   = abc123

Server Purchase
  event_name = Purchase
  event_id   = abc123
```

Meta can then treat them as two delivery channels for one event instead of two purchases.

Magnum's own PostgreSQL idempotency is separate from Meta's browser/server deduplication. We need both.

---

# Identity graph

A simplified data relationship is:

```text
Visitor
  |
  +-- Sessions
  |     |
  |     +-- Touchpoints
  |     +-- Browser Events
  |
  +-- Carts
  |     |
  |     +-- Checkouts
  |            |
  |            +-- Order
  |
  +-- Shopify Customer
```

A visitor record may accumulate multiple identifiers over time, but identifiers are never fabricated simply to improve Meta reporting.

Suggested primary tables:

```text
visitors
sessions
touchpoints
identity_keys
carts
checkouts
orders
events
event_deliveries
consents
webhook_receipts
```

## Identity keys

Rather than hardcoding every lookup into one giant visitor row, Magnum should maintain identity keys.

Examples:

```text
visitor_id -> visitor
cart_token -> visitor
checkout_token -> visitor
shopify_customer_id -> visitor
email_hash -> visitor
phone_hash -> visitor
```

This allows order reconstruction to query multiple known identifiers safely.

---

# Consent model

Magnum must integrate with Shopify Customer Privacy / consent state.

Marketing tracking is gated by the customer's applicable consent state.

If marketing tracking is not permitted, Magnum must not work around that decision by creating hidden marketing cookies or silently forwarding marketing identifiers to Meta.

The implementation should distinguish between:

```text
operational Shopify order processing
        vs
marketing measurement / advertising delivery
```

Consent state should itself be stored with the relevant event/identity context so later debugging can explain why an event was or was not sent.

---

# First-party storage

When consent permits it, the browser layer can maintain first-party Magnum identifiers on the Teenwear domain.

Proposed names:

```text
_mg_vid   -> visitor ID
_mg_sid   -> session ID
_mg_ft    -> compact first-touch reference if needed
```

Large attribution histories should not be stuffed into cookies.

The browser keeps only the minimum references required to reconnect to the server-side identity graph. Full history belongs in PostgreSQL.

`fbclid`, `fbc` and `_fbp` should be captured accurately from their legitimate source and preserved; Magnum must never generate fake historical Meta click IDs.

---

# First-touch vs last-touch

Magnum stores attribution independently from whatever attribution model Meta later applies.

Example:

```text
First touch:
Facebook Ad -> Product A

Later touch:
Google / organic -> Homepage

Purchase:
Order #1234
```

Magnum can retain both first and last touch internally.

For Meta CAPI we send identifiers tied to the actual known Meta/browser identity when appropriate. We do not rewrite history merely to make Meta receive credit for an order.

---

# Internal attribution debugger

A core Magnum feature should be an internal order debugger.

For any Shopify order we should eventually be able to inspect something like:

```text
Order: #1234
Purchase event: delivered
Meta event ID: 73b...

Identity:
visitor_id: mg_v_...
session_id: mg_s_...
cart_token: present
checkout_token: present
shopify_customer_id: present

Meta match keys:
email: yes
phone: yes
external_id: yes
fbp: yes
fbc: yes
IP: yes
UA: yes

Attribution:
first_touch: facebook / bts
last_touch: facebook / retargeting
fbclid: captured
fbc: captured

Delivery:
attempts: 1
Meta response: accepted
```

This is important because a tracking platform that only says "event sent" is not enough. We need to know why a specific order did or did not have strong match data.

---

# API structure

Initial public/internal endpoints may look like:

```text
GET  /health

POST /v1/identify
POST /v1/events
POST /v1/purchase

POST /webhooks/shopify/orders-create
POST /webhooks/shopify/orders-updated
POST /webhooks/shopify/refunds-create

GET  /internal/orders/:orderId/attribution
GET  /internal/events/:eventId
POST /internal/events/:eventId/retry
```

Internal endpoints must require authentication and must not be publicly exposed as an open customer-data API.

---

# Event processing states

Each outbound event should have an explicit state rather than relying only on logs.

Example:

```text
RECEIVED
NORMALIZED
QUEUED
SENDING
DELIVERED
RETRY
FAILED
SUPPRESSED
```

`SUPPRESSED` can explain cases such as consent or validation rules where an event was intentionally not sent.

---

# Refunds and order changes

Magnum should ingest relevant Shopify order/refund changes even if Meta handling differs by event type.

The internal order record should keep:

```text
original gross value
configured Meta attribution value
refund amount
financial status
currency
```

This gives us a trustworthy internal record instead of treating the initial Purchase payload as the only representation of the order forever.

Whether and how a downstream advertising platform should receive adjustments must be implemented according to that platform's supported API behavior rather than inventing negative purchases.

---

# Purchase value configuration

Magnum should not hardcode Shopify's displayed gross total as the only possible reporting value.

A store-level setting can define what value Magnum sends downstream, for example:

```text
GROSS_ORDER_VALUE
NET_OF_TAX
NET_OF_TAX_AND_SHIPPING
CUSTOM_RULE
```

For Teenwear we can configure Meta reporting to follow the revenue definition we actually use internally, provided the value is calculated consistently and truthfully.

The raw Shopify order totals remain stored separately so the original source data is never lost.

---

# Security

Production requirements:

- HTTPS only
- verify Shopify webhook HMAC/signatures
- secrets stored in Secret Manager
- no Meta token exposed to the browser
- least-privilege Google Cloud service accounts
- rate limiting on public ingestion endpoints
- request size limits
- schema validation on every inbound payload
- parameterized database queries / ORM safety
- no raw customer PII in routine logs
- encrypted Google Cloud storage/database transport
- authenticated internal debug endpoints
- audit trail for manual event replay where practical

---

# Deployment layout

Initial production environment:

```text
Google Cloud project: magnum-production
Region: EU region, initially europe-west1

DNS:
track.teenwear.eu
   -> Google Cloud HTTPS Load Balancer

Services:
magnum-api
magnum-worker

Database:
Cloud SQL PostgreSQL

Queue:
Google Pub/Sub

Secrets:
Google Secret Manager

Logs / metrics:
Google Cloud Logging
Google Cloud Monitoring
```

A separate staging environment should use different infrastructure/configuration:

```text
Google Cloud project: magnum-staging
staging-track.teenwear.eu
Meta Test Event Code
separate database
separate queue
```

Production purchases must never be mixed with staging/test events.

---

# Failure scenarios

## Magnum API temporarily unavailable

The Shopify webhook delivery/retry mechanism and monitoring give us another opportunity to ingest the order. The API itself should be horizontally scalable through Cloud Run.

## Meta API unavailable

The order and Purchase event already exist in PostgreSQL. Pub/Sub/retry processing attempts delivery later.

## Worker crashes after sending Meta but before acknowledging the queue

The message may be redelivered. Deterministic event identity plus database idempotency prevents us from intentionally creating a new logical purchase. Re-delivery should retain the same event ID.

## Browser tracking is blocked

The Shopify order can still be captured server-side, but match quality may be lower because browser-specific identifiers such as `fbc`/`fbp` may be unavailable.

Magnum must report this honestly instead of fabricating missing identifiers.

## Customer deletes cookies

A later session may receive a new browser visitor identity unless another legitimate deterministic identifier allows us to reconnect it. Identity merging rules must be conservative to avoid joining two different people incorrectly.

---

# What success looks like

Magnum should optimize for measurable tracking quality rather than raw event count.

Important metrics:

```text
% Shopify orders ingested by Magnum
% eligible orders delivered successfully to Meta
% purchases with email
% purchases with phone
% purchases with external_id
% purchases with fbp
% purchases with fbc
% purchases linked to browser visitor
% purchases linked to checkout/cart
Meta API rejection rate
queue retry rate
duplicate suppression rate
median webhook -> Meta delivery latency
```

The long-term objective is to maximize legitimate, complete match data while maintaining a trustworthy one-order-to-one-logical-purchase model.

---

# Implementation phases

## Phase 1 - Core engine

- identity primitives
- Meta CAPI sender
- deterministic event IDs
- ingestion API
- baseline browser SDK

## Phase 2 - Shopify identity bridge

- Shopify Web Pixel
- cart token association
- checkout token association
- order webhooks
- customer/order identity stitching
- browser/server dedupe

## Phase 3 - Production infrastructure

- Google Cloud Run
- Cloud SQL PostgreSQL
- Pub/Sub workers
- Secret Manager
- custom `track.teenwear.eu` domain
- staging + production separation

## Phase 4 - Reliability and diagnostics

- retry/dead-letter processing
- attribution debugger
- delivery logs
- match-key completeness dashboard
- alerts

## Phase 5 - Optimization

- stronger conservative identity resolution
- configurable purchase value logic
- refund/order update ingestion
- performance tuning
- attribution quality comparison against existing tracking providers

---

# Short version

The intended production flow is:

```text
Teenwear visitor
      |
      | consent-aware Shopify Web Pixel / Magnum SDK
      v
track.teenwear.eu
      |
      v
Google Cloud Run
      |
      +------> PostgreSQL identity graph
      |              |
      |              +-- visitor
      |              +-- session
      |              +-- click IDs / UTMs
      |              +-- cart
      |              +-- checkout
      |              +-- customer
      |              +-- order
      |
Shopify webhooks ----+
      |
      v
Normalized Magnum event
      |
      v
Google Pub/Sub
      |
      v
Magnum worker
      |
      v
Meta Conversions API
      |
      v
Delivery result saved back to PostgreSQL
```

That identity graph is the core of Magnum. Sending an HTTP request to Meta is easy. Reliably knowing **which real browser journey belongs to which real Shopify order** is the part that determines tracking quality.

Development happens on feature branches and is reviewed before merging.
