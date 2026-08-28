# Magnum Dashboard V1

This directory contains the first interactive product prototype for the Magnum tracking dashboard.

## Open locally

No build step is required for V1.

Open:

```text
dashboard/index.html
```

The page is deliberately self-contained so the product direction can be reviewed before we introduce a frontend framework.

## Product direction

Magnum should feel like a tracking **control center**, not another generic analytics dashboard.

The four core product surfaces are:

### 1. Live Event Stream

A real-time stream of events coming from different collection routes:

```text
Shopify App Proxy
Shopify Web Pixel
Shopify server/webhooks
Meta / TikTok / Google delivery workers
```

Each event should eventually expose:

```text
source
visitor
session
cart
checkout
customer
order
platform destination
event_id
delivery status
matching data completeness
```

### 2. Magnum Brain

Magnum Brain is the product representation of Magnum's identity graph and data model.

It should make the system explainable instead of being a black box.

Users should be able to open Magnum Brain and inspect:

```text
visitors
sessions
Shopify client IDs
Meta click IDs / fbc / fbp
carts
checkouts
customers
orders
touchpoints
identity links
outbound events
delivery attempts
```

The Brain should eventually support searching any identifier and following the complete graph around it.

Example:

```text
fbclid
  -> mg_visitor_id
  -> Shopify clientId
  -> cartToken
  -> checkoutToken
  -> Shopify customer
  -> Shopify order
  -> Meta Purchase
```

### 3. Order Inspector

Every order should be explainable.

The UI should show:

```text
match score
identity path
attribution touchpoint
checkout/cart bridge
advanced matching fields
which fields were missing
outbound payload destinations
Meta/TikTok/Google API responses
delivery/retry history
```

The goal is to answer:

> Why did this order match, or why did it not match?

without guessing from an external ad platform dashboard.

### 4. Integrations

The integrations view should eventually manage:

```text
Meta Pixel + Conversions API
TikTok Pixel + Events API
Google Ads Enhanced Conversions
Snapchat Pixel + Conversions API
Shopify
```

Connection cards should expose actual health rather than only connected/disconnected status:

```text
24h event count
last successful event
API errors
match quality
queue latency
credentials/scopes status
```

---

# What is real in V1

The V1 HTML includes working UI interactions:

- simulated live event insertion
- live event-rate counter
- animated Magnum Brain visualization
- clickable Magnum Brain drawer
- identity graph example
- database/entity inventory
- latest order table
- clickable order inspector
- advanced matching signal matrix
- responsive layout

# What is mocked in V1

All numbers and event records are demo data.

The following are not yet connected to the Magnum backend:

- live event ingestion
- real Shopify orders
- real customer identities
- platform connections
- Meta EMQ
- real delivery status
- real database counts
- real match scores

The dashboard explicitly labels itself as using demo data.

---

# Recommended frontend architecture after UX approval

Once the visual/product direction is accepted, V2 should move to a real application stack.

Recommended:

```text
Next.js / React
TypeScript
server-sent events or WebSocket live stream
Magnum API
PostgreSQL
```

Potential routes:

```text
/
/events
/brain
/orders
/orders/:id
/customers
/customers/:id
/attribution
/integrations
/diagnostics
/settings
```

Potential backend APIs:

```text
GET  /v1/dashboard/summary
GET  /v1/events/live
GET  /v1/events
GET  /v1/orders
GET  /v1/orders/:id
GET  /v1/identities/:id
GET  /v1/brain/stats
GET  /v1/brain/search?q=
GET  /v1/integrations
GET  /v1/health
```

For the live event stream, Server-Sent Events are likely sufficient initially because the browser primarily needs one-way real-time updates from Magnum.

---

# Design rules

The interface should remain:

- dark and restrained rather than neon-heavy
- information-dense without looking like an engineering console
- explainable: every metric should be drillable
- honest about unavailable signals
- centered around identity quality, not vanity event counts

Magnum Brain is the differentiating UX idea. It should eventually become the fastest way to understand everything Magnum knows about a visitor, customer or order.
