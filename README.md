# Magnum Tracking

Magnum is a Shopify-focused server-side tracking system built to maximize **truthful conversion matching** for Meta.

The core idea is not to wait until an order exists and then guess where it came from. Magnum preserves identity and ad-click context during the customer journey, links that journey to Shopify commerce identifiers, then joins the final verified order back to the strongest available browser identity.

---

# Architecture decision: Shopify App Proxy first

Normal storefront tracking will **not call the Magnum backend domain directly from the browser**.

The primary storefront path is:

```text
Customer browser
      |
      | POST /apps/magnum/e
      v
Teenwear / Shopify storefront origin
      |
      | Shopify App Proxy
      v
https://d.magnus.com/proxy/e
      |
      v
Google Cloud Run - Magnum API
```

Recommended Shopify app configuration:

```toml
[app_proxy]
url = "https://d.magnus.com/proxy"
prefix = "apps"
subpath = "magnum"
```

This creates the merchant-side route:

```text
/apps/magnum
```

and forwards child paths to the Magnum backend.

The browser therefore sends:

```text
POST /apps/magnum/e
```

and Shopify forwards it to:

```text
POST https://d.magnus.com/proxy/e
```

## Why we prefer this

A Shopify App Proxy gives Magnum useful properties:

- storefront collection starts on the merchant's Shopify origin
- Shopify forwards the request to one central Magnum backend
- no browser CORS setup is needed for storefront collection
- Shopify signs the proxy request
- Shopify supplies the shop domain
- Shopify can supply `logged_in_customer_id`
- Shopify forwards the original client IP in `X-Forwarded-For`

This does not make browser tracking unblockable. It is simply a stronger storefront collection path than exposing every normal storefront event as a direct browser request to `d.magnus.com`.

Shopify App Proxy also strips cookies from the forwarded request and strips `Set-Cookie` from the response. Magnum therefore sends required browser identifiers explicitly in the event body instead of relying on cookies reaching the backend.

---

# Important Web Pixel limitation

Shopify Web Pixels run inside a sandbox. A Web Pixel cannot be treated like normal top-frame theme JavaScript, and same-origin App Proxy fetches can be rejected by Shopify's pixel sandbox.

For that reason Magnum uses a **hybrid architecture**.

```text
STOREFRONT
Theme App Extension / App Embed
        |
        v
/apps/magnum/e
        |
        v
Shopify App Proxy
        |
        v
d.magnus.com

CHECKOUT
Shopify Web Pixel
        |
        v
external Magnum pixel endpoint
        |
        v
d.magnus.com

SHOPIFY SERVER
Order webhook / Admin GraphQL
        |
        v
d.magnus.com
```

The checkout Web Pixel is an enrichment channel, not the source of truth for purchases.

The verified Shopify order remains the source of truth.

---

# Google Cloud production stack

Magnum will run on Google Cloud Platform.

Recommended primary region:

```text
europe-west3 (Frankfurt)
```

Components:

- **Cloud Run** - public collector API and asynchronous workers
- **Cloud SQL PostgreSQL** - durable identity graph and event state
- **Pub/Sub** - outbound event queue and retry pipeline
- **Secret Manager** - Shopify secrets, Meta tokens and credentials
- **Cloud Logging / Monitoring** - event failures, queue backlog and match diagnostics

Cloud Run processes are stateless. Production identity, retries and deduplication must never depend only on an in-memory JavaScript `Map` or `Set`.

---

# Magnum identity graph

Meta CAPI itself is not the difficult part of Magnum.

The difficult part is building a reliable graph that links the final Shopify order back to the correct customer journey.

A journey can accumulate:

```text
mg_visitor_id
mg_session_id
Shopify logged_in_customer_id
Shopify Web Pixel clientId
Shopify cart token
Shopify checkout token
Shopify customer id
Shopify order id
email
phone
name
city/state/postal/country
fbclid
fbc
fbp
UTM parameters
landing URL
referrer
client IP
user agent
```

Example:

```text
Meta ad click
   |
   v
fbclid / fbc / fbp
   |
   v
mg_visitor_id
   |
   +---- Shopify logged-in customer id
   |
   +---- Shopify cart token
   |          |
   |          v
   |     Order.cartToken
   |
   +---- Web Pixel clientId
   |
   +---- checkout token
              |
              v
       Order.checkoutToken
              |
              v
        Shopify order
              |
              v
       Meta CAPI Purchase
```

---

# Deterministic matching priority

Magnum prefers deterministic commerce identifiers over probabilistic guessing.

## 1. Checkout token

When the checkout Web Pixel reaches Magnum:

```text
checkout.token
      |
      v
stored against browser identity
      |
      v
Order.checkoutToken
      |
      v
exact order link
```

## 2. Cart token

The storefront proxy collector reads the current Shopify cart and stores its token:

```text
GET /cart.js
```

The final order can expose `Order.cartToken` through Shopify Admin GraphQL.

This creates another strong bridge:

```text
mg_visitor_id
    |
    v
cart token
    |
    v
Order.cartToken
    |
    v
order
```

This bridge is especially important because it does not depend on the checkout Web Pixel successfully sending its enrichment request.

## 3. Shopify customer context

A valid signed App Proxy request can include:

```text
logged_in_customer_id
```

Magnum can attach this server-verified Shopify customer signal to the browser visitor.

## 4. Shopify Web Pixel clientId

Checkout and standard Web Pixel events contain Shopify's `clientId`.

Magnum stores:

```text
mg_visitor_id <-> shopify_client_id
```

as another identity relationship.

## 5. Customer match identifiers

When legitimately available and permitted, Magnum normalizes:

```text
email
phone
first name
last name
city
state/province
postal code
country
Shopify customer ID
```

before creating the Meta CAPI `user_data` payload.

---

# Advanced Matching target

For a strong Purchase, Magnum aims to provide as many real Meta match keys as the order legitimately contains.

Planned `user_data` coverage:

```text
em                  hashed email
ph                  hashed phone
fn                  hashed first name
ln                  hashed last name
ct                  hashed city
st                  hashed state/province
zp                  hashed postal code
country             hashed ISO country
external_id         hashed Shopify customer / Magnum identity
fbc                 raw Meta click browser identifier
fbp                 raw Meta browser identifier
client_ip_address   raw trusted client IP
client_user_agent   raw browser user agent
```

Rules:

- never create fake email/phone/name values
- never fabricate `fbclid`
- never fabricate `fbc` without a real `fbclid`
- never hash `fbc` or `fbp`
- do not guess missing phone country codes without valid country context
- do not use a session ID as a long-lived customer external ID
- preserve stable external IDs across relevant events

The objective is high-quality matching, not artificially inflating an EMQ number.

---

# Meta click preservation

When a user lands from Meta with:

```text
?fbclid=AQ...
```

Magnum captures the real click immediately after consent permits marketing processing.

If a valid `_fbc` already exists for that exact click, Magnum preserves it.

If the real `fbclid` exists but `_fbc` is not available yet, Magnum can create:

```text
fb.1.<creation_timestamp_ms>.<fbclid>
```

The timestamp is frozen for that click. Magnum must not regenerate a different `fbc` timestamp on every page or event.

`_fbp` is captured when available and the last valid value is retained as browser identity evidence.

---

# Storefront proxy collector

The first proxy-first storefront prototype is:

```text
shopify-proxy/magnum-storefront.js
```

Target installation:

```text
Shopify Theme App Extension / App Embed
```

The prototype currently:

- loads Shopify Customer Privacy API
- starts marketing/analytics collection only when processing is allowed
- creates/restores `mg_vid`
- creates/restores `mg_sid`
- captures `fbclid`
- preserves `fbc`
- captures `_fbp`
- stores first and last attribution touches
- reads `/cart.js`
- captures the Shopify cart token
- watches Shopify AJAX cart mutations and resyncs identity
- sends storefront events to `/apps/magnum/e`

The collector sends identifiers explicitly in JSON because Shopify does not forward browser cookies through App Proxy.

---

# Shopify App Proxy authentication

Every request received at:

```text
https://d.magnus.com/proxy/*
```

must be authenticated before Magnum trusts either its body or Shopify context.

Shopify adds signed query parameters such as:

```text
shop
logged_in_customer_id
path_prefix
timestamp
signature
```

The Magnum API must:

1. remove `signature`
2. canonicalize all remaining query parameters according to Shopify's App Proxy algorithm
3. calculate HMAC-SHA256 using the Shopify app shared secret
4. compare signatures using a timing-safe comparison
5. reject invalid requests
6. reject stale/replayed requests according to Magnum replay policy

Only after verification should Magnum trust:

```text
shop
logged_in_customer_id
X-Forwarded-For
```

The proxy body itself can then add:

```text
mg_visitor_id
mg_session_id
cart_token
fbclid
fbc
fbp
UTMs
page/referrer
user agent
consent state
```

---

# Checkout Web Pixel

The checkout Web Pixel remains valuable because Shopify can expose checkout-specific identifiers and protected customer fields that a normal theme script cannot access.

Important fields include:

```text
Shopify event.clientId
checkout.token
checkout email
checkout phone
shipping/billing name
city
province/state
postal code
country
order/customer IDs when available
```

Because the Web Pixel sandbox cannot rely on the storefront App Proxy route, checkout enrichment is sent to a dedicated external Magnum endpoint.

That direct checkout channel is **not enough by itself**. It complements the proxy-first storefront identity graph.

---

# Final Purchase flow

The final purchase should be generated from verified Shopify server data.

```text
1. Storefront proxy captures Meta + Magnum + cart identity
2. Checkout Web Pixel adds checkout/client/customer identity when available
3. Shopify confirms the real order
4. Magnum fetches/enriches order through Admin GraphQL when necessary
5. Magnum resolves checkoutToken and/or cartToken back to browser identity
6. Customer match fields are normalized and hashed where required
7. Purchase event is inserted into durable outbound queue
8. Worker sends Meta CAPI
9. Temporary failures retry
10. Permanent validation failures are retained for debugging
```

The system should never create a Meta Purchase just because the browser says checkout completed if Shopify has not confirmed the order.

---

# Purchase deduplication

When Magnum also sends a browser Purchase, browser and server must share one deterministic Meta `event_id`.

Example:

```text
magnum_purchase_<shopify_order_id>
```

```text
browser Purchase ----+
                     +----> Meta: one Purchase
server Purchase  ----+
```

Production idempotency is stored in PostgreSQL with unique constraints. An in-memory set is not sufficient.

---

# Magnum Match Diagnostics

Every order should eventually expose exactly why its matching is strong or weak.

Example:

```text
ORDER #12345

Commerce bridge
[OK] cart token
[OK] checkout token
[OK] Shopify clientId
[OK] Magnum visitor ID

Meta identity
[OK] real fbclid
[OK] fbc
[OK] fbp

Advanced matching
[OK] email
[OK] phone
[OK] first/last name
[OK] city/state/postal/country
[OK] external ID
[OK] client IP
[OK] user agent

Resolution path:
Meta click -> visitor -> cart -> checkout -> order

Confidence: HIGH
```

A weak order should show the missing reason rather than hiding it behind one opaque score.

---

# Production data model

Planned PostgreSQL entities:

```text
shops
visitors
sessions
shopify_clients
carts
checkouts
customers
touchpoints
orders
identity_links
ingest_events
outbound_events
delivery_attempts
```

Important unique/indexed identifiers include:

```text
shop + Shopify event ID
shop + cart token
shop + checkout token
shop + order ID
destination + Meta event ID
```

Customer PII should be minimized. Fields required only for Meta matching should be normalized and hashed as early as practical instead of retaining raw customer data indefinitely.

---

# Implementation roadmap

## Phase 0 - collection prototypes

- [x] define identity graph
- [x] define advanced matching keys
- [x] build Shopify Custom Pixel prototype
- [x] build Shopify App Proxy storefront collector prototype
- [x] switch architecture to proxy-first storefront collection
- [ ] create Shopify Theme App Extension / App Embed package
- [ ] create the actual Shopify app proxy configuration

## Phase 1 - secure proxy ingestion

- [ ] `POST /proxy/e`
- [ ] verify Shopify App Proxy HMAC signature
- [ ] timestamp/replay validation
- [ ] parse trusted `logged_in_customer_id`
- [ ] parse trusted `X-Forwarded-For`
- [ ] validate event schema and size
- [ ] rate/abuse limits

## Phase 2 - PostgreSQL identity graph

- [ ] persist visitor/session identities
- [ ] persist touchpoint history
- [ ] persist cart-token mapping
- [ ] persist Web Pixel `clientId`
- [ ] persist checkout-token mapping
- [ ] persist customer links

## Phase 3 - Shopify server order bridge

- [ ] verified Shopify order webhooks
- [ ] Admin GraphQL enrichment
- [ ] read `Order.cartToken`
- [ ] read `Order.checkoutToken`
- [ ] read trusted order/customer/network fields
- [ ] resolve order to Magnum identity graph

## Phase 4 - Meta CAPI

- [ ] full advanced matching payload
- [ ] deterministic Purchase event ID
- [ ] durable Pub/Sub/outbox delivery
- [ ] retry policy
- [ ] dead-letter/permanent-error handling
- [ ] Meta test-event support

## Phase 5 - diagnostics

- [ ] per-order identity timeline
- [ ] match-key presence matrix
- [ ] missing-signal reasons
- [ ] Meta request/response status
- [ ] daily collection health
- [ ] storefront proxy vs checkout-pixel coverage comparison

---

# What Magnum will not do

Magnum will not:

- fabricate Meta clicks
- fabricate `fbc`
- attach unrelated historical clicks to orders simply to increase reported ROAS
- claim deterministic attribution from IP similarity alone
- intentionally bypass a visitor's Shopify privacy decision
- treat Meta Ads Manager as the store revenue source of truth

Shopify is the source of truth for orders.

Magnum's job is to preserve and send the strongest legitimate evidence possible so Meta has the best possible chance to match eligible conversions correctly.

---

# Repository structure

```text
docs/
    advanced-matching.md

shopify-proxy/
    magnum-storefront.js
    README.md

shopify-pixel/
    magnum-custom-pixel.js
    README.md
```

Current next engineering target:

```text
/apps/magnum/e
      -> Shopify signed App Proxy request
      -> https://d.magnus.com/proxy/e
      -> verify signature
      -> PostgreSQL identity graph
      -> cartToken / checkoutToken order resolution
      -> Meta CAPI Purchase
```
