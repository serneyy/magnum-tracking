<p align="center">
  <img src="https://cdn.shopify.com/s/files/1/0685/9060/0494/files/m_2.jpg?v=1787914555" alt="Telence logo" width="112" />
</p>

<h1 align="center">Telence</h1>

<p align="center"><strong>Identity and conversion intelligence infrastructure for Shopify.</strong></p>

Telence connects browser signals, Shopify commerce identity and ad-platform identifiers into one durable identity graph, then sends the strongest legitimate conversion payload to destinations such as Meta.

## Dashboard

Opening Telence inside Shopify Admin now shows a live tracking control center:

- Telence Brain live/standby state
- events in the last 5 minutes and 24 hours
- Shopify order receipts
- App Proxy versus Web Pixel ingestion
- recent visitor/cart/checkout identity coverage
- recent `fbc` and `fbp` presence
- auto-refreshing live event stream
- Web Pixel activation status

The dashboard refreshes every four seconds while the tab is visible.

## Shopify app icon

Telence uses this logo throughout the embedded app:

`https://cdn.shopify.com/s/files/1/0685/9060/0494/files/m_2.jpg?v=1787914555`

The icon that Shopify itself displays on the Apps page and in Shopify Admin navigation is managed by Shopify, not by application code. Upload the square Telence logo in:

`Shopify Dev Dashboard -> Telence -> Settings -> App icon`

Shopify currently requires a square PNG or JPG at 1200 x 1200 px without pre-rounded corners.

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

Telence uses Shopify's React Router app stack and is being built as a real embedded Shopify app.

Core pieces:

- Embedded Shopify Admin app
- Shopify App Proxy at `/apps/telence`
- Theme app extension for first-hop storefront collection
- Web Pixel extension for checkout/customer events
- Shopify-managed scopes and webhooks
- PostgreSQL/Prisma production persistence
- SQLite persistence for the one-click local development flow
- per-store Telence pixel key
- activation flow using `webPixelCreate`
- Telence Brain identity graph and diagnostics

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

Telence is designed to preserve and resolve real customer and browser signals rather than fabricate attribution.

Depending on what is legitimately available for a purchase, the final destination payload can include:

```text
email
phone
first name
last name
city
state / province
postal code
country
Shopify customer ID
Telence visitor ID
fbc
fbp
client IP
user agent
cart token
checkout token
Shopify clientId
```

See `docs/advanced-matching.md` for the detailed matching strategy.

## Easiest Windows development flow

For the first Shopify test, no external PostgreSQL database is required.

1. Open the repository folder.
2. Double-click `START_TELENCE.bat`.
3. Sign in to Shopify if requested.
4. Create or select `Telence Development`.
5. Choose a development store.
6. Click `Install app` when Shopify opens the install screen.
7. Keep the Telence launcher window open while testing.

The launcher installs Shopify CLI/project dependencies if necessary and starts `shopify app dev --reset` automatically. Local development uses `prisma/schema.dev.prisma` with SQLite. Production remains PostgreSQL.

## Environment

See `.env.example`. Secrets must never be committed.

## Development strategy

Telence should first run in **shadow mode**: collect and resolve real journeys without sending production Purchase events to ad platforms. Once order resolution, `fbc/fbp`, advanced matching and deduplication are verified, outbound conversion delivery can be enabled.

## Current status

The Shopify app foundation currently includes:

- Shopify authentication
- embedded admin dashboard
- live tracking event stream
- PostgreSQL production + SQLite local-development Prisma models
- App Proxy ingestion
- Web Pixel ingestion
- Theme App Extension
- Web Pixel Extension
- order/refund/uninstall/privacy webhooks
- Web Pixel activation flow
- CI typecheck and production build

Production Meta delivery remains intentionally disabled until shadow-mode validation is complete.
