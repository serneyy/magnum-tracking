<p align="center">
  <img src="https://cdn.shopify.com/s/files/1/0685/9060/0494/files/m_2.jpg?v=1787914555" alt="Telence logo" width="112" />
</p>

<h1 align="center">Telence</h1>

<p align="center"><strong>Identity and conversion intelligence infrastructure for Shopify.</strong></p>

Telence connects browser signals, Shopify commerce identity and ad-platform identifiers into one durable identity graph, then sends the strongest legitimate conversion payload to destinations such as Meta.

## Dashboard

Opening Telence inside Shopify Admin shows a live tracking control center with Telence Brain status, recent events, order receipts, App Proxy versus Web Pixel ingestion, visitor/cart/checkout coverage, `fbc`/`fbp` presence and a live event stream.

## Shopify app icon

Telence uses this logo throughout the embedded app:

`https://cdn.shopify.com/s/files/1/0685/9060/0494/files/m_2.jpg?v=1787914555`

The icon that Shopify itself displays on the Apps page and in Shopify Admin navigation is managed in Shopify Dev Dashboard -> Telence -> Settings -> App icon.

## Architecture

```text
Storefront browser
    -> /apps/telence/e
    -> Shopify App Proxy
    -> Telence API

Shopify Web Pixel
    -> checkout/customer events
    -> Telence pixel endpoint

Shopify webhooks
    -> verified order truth
    -> order enrichment / identity resolution

Telence Brain
    -> visitor + cart + checkout + customer + order graph
    -> Meta / TikTok / Google destinations
```

## Shopify app

Core pieces:

- Embedded Shopify Admin app
- Shopify App Proxy at `/apps/telence`
- Theme app extension for first-hop storefront collection
- Web Pixel extension for checkout/customer events
- automatic Web Pixel provisioning after authorization
- Web Pixel self-heal/update whenever the embedded app opens
- Shopify-managed scopes and webhooks
- PostgreSQL/Prisma production persistence
- SQLite persistence for local development
- per-store Telence pixel key
- Telence Brain identity graph and diagnostics

## Automatic Web Pixel provisioning

Merchants do not need to manually create a Telence Web Pixel. After Shopify authorization, Telence checks the current store-level Web Pixel and either creates it with `webPixelCreate` or updates it with `webPixelUpdate`.

For already-installed stores the embedded app repeats this check when it opens, so a missing or stale Web Pixel can self-heal without reinstalling the app.

During development the pixel endpoint follows the current `SHOPIFY_APP_URL` and resolves to `/pixel/e`. In production it can be pinned with `TELENCE_PIXEL_ENDPOINT` and will ultimately use the permanent Telence collector hostname.

## Identity namespace

Telence-owned browser identifiers use the `tl_*` namespace.

```text
tl_visitor_id
tl_session_id
```

The planned production collector/API hostname is:

```text
https://d.telence.com
```

The storefront App Proxy path is:

```text
/apps/telence
```

## Required Shopify scopes

```text
read_orders
read_customers
write_app_proxy
write_pixels
read_customer_events
```

Protected customer data approval will also be required before a public production app can receive fields such as email, phone and address through Shopify surfaces.

## Advanced matching

Telence preserves and resolves real customer and browser signals rather than fabricating attribution. Depending on what is legitimately available for a purchase, the final destination payload can include email, phone, name/address fields, Shopify customer ID, Telence visitor ID, `fbc`, `fbp`, client IP, user agent, cart token, checkout token and Shopify clientId.

See `docs/advanced-matching.md` for the detailed matching strategy.

## Development strategy

Telence should first run in **shadow mode**: collect and resolve real journeys without sending production Purchase events to ad platforms. Once order resolution, `fbc/fbp`, advanced matching and deduplication are verified, outbound conversion delivery can be enabled.

## Current status

The Shopify app foundation currently includes Shopify authentication, embedded admin dashboard, live event stream, PostgreSQL production + SQLite local-development Prisma models, App Proxy ingestion, Web Pixel ingestion, automatic Web Pixel create/update, Theme App Extension, Web Pixel Extension, order/refund/uninstall/privacy webhooks and CI typecheck/build checks.

Production Meta delivery remains intentionally disabled until shadow-mode validation is complete.
