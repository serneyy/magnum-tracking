<p align="center">
  <img src="https://cdn.shopify.com/s/files/1/0685/9060/0494/files/m_2.jpg?v=1787914555" alt="Telence logo" width="112" />
</p>

<h1 align="center">Telence</h1>

<p align="center"><strong>Identity and conversion intelligence infrastructure for Shopify.</strong></p>

Telence connects browser signals, Shopify commerce identity and ad-platform identifiers into one durable identity graph, then sends the strongest legitimate conversion payload to destinations such as Meta.

## Fastest Windows start

For local Shopify testing, Telence is intentionally zero-config.

1. Clone or pull this repository.
2. Double-click `START_TELENCE.bat`.
3. Sign in to Shopify when the browser opens.
4. Choose your Shopify organization.
5. Create/select **Telence Development**.
6. Choose a development store.
7. Open the preview and click **Install app**.

The launcher installs Shopify CLI if needed, installs npm packages if needed and starts `shopify app dev --reset` for you.

Local development uses a separate SQLite database at `prisma/dev.sqlite`, so no PostgreSQL, Neon or Supabase account is required for the first test. The production architecture can continue using PostgreSQL.

Do not run `npm audit fix --force` just to clear dependency warnings during setup.

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

Telence uses Shopify's React Router app stack and is built as an embedded Shopify app.

Core pieces:

- Embedded Shopify Admin app
- Shopify App Proxy at `/apps/telence`
- Theme app extension for first-hop storefront collection
- Web Pixel extension for checkout/customer events
- Shopify-managed scopes and webhooks
- Prisma persistence
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

## Manual local development

If you do not want to use `START_TELENCE.bat`:

```text
npm install
shopify app dev --reset
```

Shopify CLI links/creates the development app, supplies the development tunnel and lets you choose the dev store. The Telence web process automatically generates the Prisma client from `prisma/schema.dev.prisma` and creates the local SQLite database.

## Production database

`prisma/schema.prisma` remains the production PostgreSQL schema. Local Shopify development uses `prisma/schema.dev.prisma` only to remove external database setup from the first-run experience.

Secrets must never be committed.

## Development strategy

Telence should first run in **shadow mode**: collect and resolve real journeys without sending production Purchase events to ad platforms. Once order resolution, `fbc/fbp`, advanced matching and deduplication are verified, outbound conversion delivery can be enabled.

## Current status

The Shopify app foundation currently includes:

- Shopify authentication
- embedded admin shell
- PostgreSQL production models
- zero-config SQLite local development
- App Proxy ingestion
- Web Pixel ingestion
- Theme App Extension
- Web Pixel Extension
- order/refund/uninstall/privacy webhooks
- Web Pixel activation flow
- CI typecheck and production build

Production Meta delivery remains intentionally disabled until shadow-mode validation is complete.
