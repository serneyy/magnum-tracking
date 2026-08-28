# Telence Shopify App Setup

## 1. Link the repository to a Shopify development app

```bash
npm install
shopify app config link
```

Shopify creates/updates the real `shopify.app.toml` with the app's `client_id`. Copy the scopes, webhooks and App Proxy settings from `shopify.app.toml.example` into the linked configuration.

## 2. Database

Use PostgreSQL from day one so local and Cloud SQL behavior stay aligned.

```bash
cp .env.example .env
# set DATABASE_URL
npx prisma migrate dev --name init
```

## 3. Extensions

The repository contains:

- `extensions/telence-storefront` — Theme App Embed; sends storefront events through `/apps/telence/e`
- `extensions/telence-web-pixel` — Shopify Web Pixel; captures checkout/customer events and sends them to `/pixel/e`

Shopify manages extension UIDs. Do not invent or copy a UID between unrelated apps. Run Shopify CLI generation/deploy so Shopify assigns the extension records.

## 4. Start development

```bash
npm run dev
```

Select the development store. Shopify CLI creates the HTTPS tunnel and updates development URLs automatically.

## 5. Enable the theme app embed

In the development store's theme editor enable **Telence tracking** under App embeds. This injects the storefront collector without editing the merchant theme source.

## 6. Enable the Web Pixel

Open Telence inside Shopify Admin and click **Enable Telence Web Pixel**. The app creates a per-store public ingestion key and calls Shopify's `webPixelCreate` mutation.

## 7. Shadow mode first

Do not enable production Meta Purchase delivery yet. First verify that Telence receives:

```text
tl_visitor_id
tl_session_id
fbclid / fbc / fbp
cart token
Shopify clientId
checkout token
customer match fields
Shopify order webhook
```

Then prove order resolution on real journeys before enabling outbound destination delivery.
