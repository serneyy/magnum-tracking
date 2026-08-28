# Telence Advanced Matching Strategy

Telence should maximize the **correctness and completeness** of Meta customer-information parameters for every real Shopify order. It must never manufacture attribution merely to raise a score.

## Identity path

```text
Meta click
  -> fbclid / fbc / fbp
  -> Telence visitor ID
  -> Shopify clientId
  -> cart token
  -> checkout token
  -> verified Shopify order
  -> customer match keys
  -> final destination event
```

The strongest joins are deterministic. Prefer `Order.checkoutToken` and `Order.cartToken` over probabilistic IP/UA matching.

## Meta customer information

Hash after Meta-compatible normalization:

```text
em          email
ph          phone
fn          first name
ln          last name
ct          city
st          state / province
zp          postal code
country     two-letter country code
external_id Shopify customer ID + Telence visitor ID
```

Send unhashed where required:

```text
fbc
fbp
client_ip_address
client_user_agent
```

Never invent `fbclid`, `fbc`, email, phone, geography, DOB or gender. Missing legitimate data is better than false data.

## fbc / fbp

Only create `fbc` when a real `fbclid` was captured and a matching `_fbc` is unavailable. Freeze the creation timestamp for that click:

```text
fb.1.<creation_timestamp_ms>.<fbclid>
```

Preserve the real `_fbp` when available. Neither `fbc` nor `fbp` is hashed.

## Diagnostics

Every Purchase should expose why its payload is strong or weak:

```text
email               AVAILABLE
phone               AVAILABLE
fbc                 AVAILABLE
fbp                 AVAILABLE
external_id         AVAILABLE
client IP           AVAILABLE
user agent          AVAILABLE
checkout token      AVAILABLE
cart token          AVAILABLE
```

Missing-state reasons should be explicit, for example `no Meta click captured`, `customer did not provide phone`, or `checkout pixel unavailable`.

Telence's internal Match Score is diagnostic only. It must not pretend to reproduce Meta's private Event Match Quality weighting.

## Production proof

Before claiming Telence is better than an established tracker, shadow-test real orders and measure:

- deterministic order -> visitor resolution rate
- Meta-origin orders with valid `fbc`
- orders with `fbp`
- email/phone/geography availability
- actual client IP + user agent availability
- Meta CAPI acceptance/rejection rate
- purchase duplication rate
- browser collector loss rate
- Ads Manager attributed purchases after sufficient reporting delay
