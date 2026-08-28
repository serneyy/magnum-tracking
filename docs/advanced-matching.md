# Magnum Advanced Matching Strategy

Magnum's goal is not merely to send a server-side `Purchase`. The goal is to give Meta the strongest legitimate customer-information payload possible for every real Shopify order.

## Reality check versus competitors

Magnum should not claim to be better than established tracking tools until production data proves it.

Competitors such as wetracked.io already market:

- first-party tracking
- data enrichment
- fingerprinting
- advanced matching
- ad-block resilience
- multi-platform delivery

Magnum's intended advantage is different:

1. deterministic Shopify identity stitching through checkout/order identifiers
2. transparent, inspectable match-key diagnostics for every order
3. strict preservation of real Meta click identity (`fbclid` -> stable `fbc`)
4. full customer-information payloads instead of only email/phone
5. controllable event value, retries, deduplication and attribution logic
6. no fabricated attribution

Because `d.magnum.com` is a third-party collector, Magnum may be blocked by privacy/ad-blocking tools more often than a true first-party collector. This is an explicit tradeoff and must be measured in production.

---

# Meta customer information parameters

For a high-quality Purchase event Magnum should attempt to send every legitimate field that is actually available.

## Hashed with SHA-256 after normalization

```text
em          email
ph          phone
fn          first name
ln          last name
ct          city
st          state / province
zp          postal code
country     two-letter country code
external_id stable merchant / visitor identifiers
```

## Sent unhashed

```text
fbc                  Meta click identity
fbp                  Meta browser identity
client_ip_address    actual browser/client IP
client_user_agent    actual browser user agent
```

Magnum must never invent missing values merely to raise Event Match Quality.

---

# Normalization rules

## Email

```text
trim
lowercase
SHA-256
```

## Phone

The final canonical value should contain digits and an international country code before hashing.

Magnum must not blindly guess a country code. Order ingestion should use the customer's Shopify country to canonicalize local phone numbers before SHA-256 hashing.

## Name / geography

Normalize Unicode, trim and lowercase before hashing. Country must resolve to a valid two-letter code.

Do not collect date of birth or gender unless the merchant already legitimately collects that information for a real business purpose and the value is accurate.

---

# External IDs

Magnum should provide stable identifiers rather than ephemeral session IDs.

Preferred values:

```text
Shopify customer ID -> SHA-256
Magnum visitor ID   -> SHA-256
```

Do not use the session ID as an `external_id` because it changes too frequently.

A logged-in customer's stable Shopify ID is stronger long-term evidence than a session-only identifier.

---

# Click and browser identity

## fbc

`fbc` should exist only when Magnum has a real Meta `fbclid` or an existing valid `_fbc` value.

Example:

```text
fb.1.<creation_timestamp_ms>.<fbclid>
```

The value should be frozen for that click. Rebuilding the same click with a fresh timestamp on every event damages identity consistency.

## fbp

Preserve the real `_fbp` when available. Do not hash it.

---

# Purchase identity resolution

The ideal final flow is:

```text
Meta click
  -> fbclid / fbc / fbp
  -> Magnum visitor ID
  -> Shopify clientId
  -> cart
  -> checkoutToken
  -> Shopify order
  -> customer + address match keys
  -> final Meta CAPI Purchase
```

The strongest commerce join should be deterministic, preferably:

```text
Order.checkoutToken -> captured checkout.token -> visitor identity
```

Cart token and other deterministic identifiers provide secondary evidence.

IP-only or user-agent-only similarity must never be used to claim that a specific order came from a specific ad.

---

# Advanced Matching diagnostics

For each final Purchase, Magnum should store a presence report such as:

```text
em                  YES
ph                  YES
fn                  YES
ln                  YES
ct                  YES
st                  YES
zp                  YES
country             YES
external_id         YES
fbc                 YES
fbp                 YES
client_ip_address   YES
client_user_agent   YES
```

The debugger should also distinguish *why* a key is missing:

```text
fbc: missing - no Meta click captured
phone: missing - customer did not provide phone
fbp: missing - cookie unavailable
checkout token: missing - browser checkout event was blocked
```

This is more useful than a cosmetic score alone.

Do not claim that Magnum knows Meta's private numeric EMQ weighting. Meta does not expose a stable public per-field scoring formula.

---

# Browser Advanced Matching vs CAPI customer information

These are related but not identical concepts.

Magnum's first priority is **server-side CAPI customer information** because the final Purchase is built from the verified Shopify order.

Browser Pixel automatic/manual Advanced Matching can be added later, but it must be designed together with browser/server event deduplication. Running another browser Purchase alongside an existing Shopify/Meta integration without shared event IDs can create duplicate conversion events.

Before enabling Magnum browser Purchase delivery in production, we must decide whether:

1. Shopify's native Meta browser Pixel remains active and Magnum sends only compatible server events with shared event IDs, or
2. Magnum owns both browser and server event delivery for the relevant dataset.

Do not run two independent Purchase implementations with unrelated `event_id` values.

---

# Production target

For a normal completed Shopify order where the customer arrived from a Meta ad, the desired Meta `user_data` payload is conceptually:

```json
{
  "em": ["<sha256>"],
  "ph": ["<sha256>"],
  "fn": ["<sha256>"],
  "ln": ["<sha256>"],
  "ct": ["<sha256>"],
  "st": ["<sha256>"],
  "zp": ["<sha256>"],
  "country": ["<sha256>"],
  "external_id": ["<sha256 customer id>", "<sha256 visitor id>"],
  "fbc": "fb.1....",
  "fbp": "fb.1....",
  "client_ip_address": "...",
  "client_user_agent": "..."
}
```

Some fields will legitimately be absent on some orders. The engineering goal is maximum correctness and completeness, not artificial 100% presence.

---

# What must be proven before claiming Magnum is better

Run Magnum side-by-side in observation/test mode and measure at least:

```text
% orders with deterministic checkout/order join
% Meta-click orders with valid fbc
% orders with fbp
% orders with em
% orders with ph
% orders with full geography match keys
% orders with real client IP + UA
Meta Event Match Quality for Purchase
Meta-attributed purchases / known Meta-origin purchases
server event rejection rate
browser collector block/loss rate
purchase duplication rate
```

Only production results should decide whether Magnum is actually better than TrueTracked, wetracked.io, Shopify native tracking or another competitor.
