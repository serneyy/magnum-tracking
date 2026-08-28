<p align="center">
  <img src="https://cdn.shopify.com/s/files/1/0685/9060/0494/files/m_2.jpg?v=1787914555" alt="Telence logo" width="112" />
</p>

<h1 align="center">Telence</h1>

<p align="center"><strong>Identity and conversion intelligence infrastructure for Shopify.</strong></p>

Telence connects browser signals, Shopify commerce identity and ad-platform identifiers into one durable identity graph, then sends the strongest legitimate conversion payload to destinations such as Meta.

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
- PostgreSQL/Prisma persistence
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

## Local development

1. Install Node.js and Shopify CLI.
2. Run `npm install`.
3. Create/select the Telence Development app in Shopify Dev Dashboard.
4. Run `shopify app config link`.
5. Use `shopify.app.toml.example` as the configuration reference while preserving Shopify's real `client_id`.
6. Create PostgreSQL and set `DATABASE_URL`.
7. Run `npm run dev` and select the development store.
8. Generate/deploy the app extensions so Shopify assigns extension UIDs.
9. Open Telence inside Shopify Admin and activate the Telence Web Pixel.

## Environment

See `.env.example`. Secrets must never be committed.

## Development strategy

Telence should first run in **shadow mode**: collect and resolve real journeys without sending production Purchase events to ad platforms. Once order resolution, `fbc/fbp`, advanced matching and deduplication are verified, outbound conversion delivery can be enabled.

## Current status

The Shopify app foundation currently includes:

- Shopify authentication
- embedded admin shell
- PostgreSQL/Prisma models
- App Proxy ingestion
- Web Pixel ingestion
- Theme App Extension
- Web Pixel Extension
- order/refund/uninstall/privacy webhooks
- Web Pixel activation flow
- CI typecheck and production build

Production Meta delivery remains intentionally disabled until shadow-mode validation is complete.
