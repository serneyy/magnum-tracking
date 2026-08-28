# Telence

**Telence is identity and conversion intelligence infrastructure for Shopify.**

Telence connects browser signals, Shopify commerce identity and ad-platform identifiers into one durable identity graph, then sends the strongest legitimate conversion payload to destinations such as Meta.

> Previous working name: Magnum. New code should use the `Telence` brand, `tl_*` browser identifiers, `/apps/telence` proxy namespace and the future `d.telence.com` backend hostname.

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

This branch starts the real Shopify app implementation using Shopify's recommended React Router app stack.

Core pieces:

- Embedded Shopify Admin app
- Shopify App Proxy at `/apps/telence`
- Theme app extension for first-hop storefront collection
- Web Pixel extension for checkout/customer events
- Shopify-managed scopes and webhooks
- PostgreSQL/Prisma persistence
- per-store Telence pixel key
- activation flow using `webPixelCreate`

## Required Shopify scopes

```text
read_orders
read_customers
write_app_proxy
write_pixels
read_customer_events
```

Protected customer data approval will also be required before a public production app can receive fields such as email, phone and address through Shopify surfaces.

## Local setup

1. Install Node.js 20.19+ and Shopify CLI.
2. Run `npm install`.
3. In the Shopify Dev Dashboard create/select the Telence development app.
4. Run `shopify app config link`.
5. Copy the Telence settings from `shopify.app.toml.example` into the generated linked config, preserving Shopify's real `client_id`.
6. Create PostgreSQL and set `DATABASE_URL`.
7. Run `npm run dev` and select the development store.
8. Generate/deploy the app extensions so Shopify assigns extension UIDs.
9. Open Telence inside Shopify Admin and activate the Telence Web Pixel.

## Environment

See `.env.example`. Secrets must never be committed.

## Development strategy

Telence should first run in **shadow mode** on Teenwear: collect and resolve real journeys without sending production Purchase events to Meta. Once order resolution, `fbc/fbp`, advanced matching and deduplication are verified, outbound CAPI delivery can be enabled.
