# Magnum Shopify App Proxy

Magnum uses a Shopify App Proxy as the primary storefront collection path.

## Request flow

```text
Teenwear browser
   |
   | POST /apps/magnum/e
   v
Shopify storefront origin
   |
   | Shopify App Proxy
   v
https://d.magnus.com/proxy/e
   |
   v
Magnum API on Google Cloud Run
```

The browser does not call `d.magnus.com` directly for normal storefront collection. The request is first sent to the merchant storefront origin and Shopify forwards it to Magnum.

Recommended Shopify app configuration:

```toml
[app_proxy]
url = "https://d.magnus.com/proxy"
prefix = "apps"
subpath = "magnum"
```

This gives the storefront route:

```text
/apps/magnum
```

and therefore:

```text
POST /apps/magnum/e
```

is forwarded by Shopify to:

```text
POST https://d.magnus.com/proxy/e
```

## Why use the proxy

Benefits:

- storefront requests are initiated against the merchant's own Shopify origin
- no browser CORS configuration is required for the storefront collector
- Shopify signs every app-proxy request
- Shopify adds the shop domain to the request
- Shopify can add `logged_in_customer_id`
- Shopify forwards the original client IP in `X-Forwarded-For`
- Magnum can run one central backend for multiple merchants

The proxy is not magic anti-adblock technology. It can reduce direct exposure of the collector hostname in storefront requests, but tracking quality still depends on browser behavior, consent, Shopify restrictions and the merchant implementation.

## Important Shopify limitation

Shopify Web Pixels run in a sandbox. As of 2026, Shopify's pixel sandbox can reject fetches to a same-origin App Proxy route with `RestrictedUrlError`.

Therefore Magnum uses a hybrid architecture:

```text
STORE FRONT
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
```

The checkout Web Pixel is an enrichment channel. The final purchase should still be generated from verified Shopify server order data.

## Cookies and identifiers

Shopify App Proxy strips request cookies and strips `Set-Cookie` responses. Magnum therefore does not rely on cookies being forwarded through the proxy.

The storefront collector explicitly sends the values it is allowed to process in the JSON body, including:

```text
mg_visitor_id
mg_session_id
cart_token
fbclid
fbc
fbp
UTM data
landing URL
referrer
consent state
user agent
```

The collector stores its own browser identity locally only when Shopify Customer Privacy says analytics and marketing processing are allowed.

## Cart token bridge

The storefront collector reads Shopify's current cart from:

```text
GET /cart.js
```

and records the returned cart token.

This gives Magnum a strong bridge:

```text
Meta click
   -> mg_visitor_id
   -> Shopify cart token
   -> Shopify Order.cartToken
   -> final order
```

The checkout Web Pixel can add a second deterministic bridge through `checkout.token` / `Order.checkoutToken` when its event reaches Magnum.

## Proxy authentication

Every request received at `https://d.magnus.com/proxy/*` must be authenticated before its body is trusted.

Shopify app-proxy requests include signed query parameters such as:

```text
shop
logged_in_customer_id
path_prefix
timestamp
signature
```

The backend must:

1. remove `signature`
2. canonicalize all remaining query parameters exactly according to Shopify's app-proxy algorithm
3. compute HMAC-SHA256 with the Shopify app shared secret
4. compare using a timing-safe comparison
5. reject invalid signatures
6. reject stale timestamps according to Magnum's replay policy

`logged_in_customer_id` is useful identity evidence, but it must be treated as Shopify-provided context from a valid signed proxy request, not as a browser-trusted field.

## Client IP

Shopify forwards the original client IP through `X-Forwarded-For` on app-proxy requests.

The Magnum API should parse the trusted proxy header only after the request has passed Shopify signature validation and should store the selected client IP with the event/order identity record for later Meta CAPI matching.

## Storefront collector

The first prototype lives at:

```text
shopify-proxy/magnum-storefront.js
```

It is intended to become a Shopify Theme App Extension / App Embed.

Current behavior:

- loads Shopify Customer Privacy API
- starts only when analytics + marketing processing are allowed
- creates/restores `mg_vid`
- creates/restores `mg_sid`
- captures real `fbclid`
- preserves stable `fbc`
- reads `_fbp`
- preserves first and last attribution touches
- reads `/cart.js` to capture cart token
- sends `page_viewed`
- watches Shopify AJAX cart mutations and resyncs cart identity
- posts to `/apps/magnum/e`

## Production target

The final Magnum collection model is:

```text
storefront proxy collector
      +
checkout Web Pixel enrichment
      +
verified Shopify order webhooks/Admin GraphQL
      =
Magnum identity graph
      =
strongest truthful Meta Purchase payload
```
