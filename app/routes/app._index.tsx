import { randomBytes } from "node:crypto";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const installation = await db.shopInstallation.findUnique({ where: { shop: session.shop } });
  const [events, orders] = await Promise.all([
    db.ingestEvent.count({ where: { shop: session.shop } }),
    db.shopifyOrderReceipt.count({ where: { shop: session.shop } }),
  ]);

  return {
    shop: session.shop,
    active: Boolean(installation?.webPixelId),
    webPixelId: installation?.webPixelId ?? null,
    events,
    orders,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = form.get("intent");
  if (intent !== "activate_pixel") return { ok: false, error: "unknown_intent" };

  let installation = await db.shopInstallation.upsert({
    where: { shop: session.shop },
    update: { uninstalledAt: null },
    create: { shop: session.shop },
  });

  if (installation.webPixelId) {
    return { ok: true, webPixelId: installation.webPixelId, alreadyActive: true };
  }

  const publicPixelKey = installation.publicPixelKey || randomBytes(24).toString("hex");
  if (!installation.publicPixelKey) {
    installation = await db.shopInstallation.update({
      where: { shop: session.shop },
      data: { publicPixelKey },
    });
  }

  const response = await admin.graphql(
    `#graphql
      mutation TelenceWebPixelCreate($webPixel: WebPixelInput!) {
        webPixelCreate(webPixel: $webPixel) {
          webPixel { id settings }
          userErrors { field message code }
        }
      }
    `,
    {
      variables: {
        webPixel: {
          settings: {
            endpoint: process.env.TELENCE_PIXEL_ENDPOINT || "https://d.telence.com/pixel/e",
            publicKey,
          },
        },
      },
    },
  );

  const json = await response.json();
  const result = json.data?.webPixelCreate;
  if (result?.userErrors?.length) {
    return { ok: false, error: result.userErrors.map((e: { message: string }) => e.message).join("; ") };
  }

  const webPixelId = result?.webPixel?.id as string | undefined;
  if (!webPixelId) return { ok: false, error: "Shopify did not return a Web Pixel ID." };

  await db.shopInstallation.update({
    where: { shop: session.shop },
    data: { webPixelId },
  });

  return { ok: true, webPixelId };
};

const card: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #e3e3e3",
  borderRadius: 12,
  padding: 20,
};

export default function Home() {
  const data = useLoaderData<typeof loader>();
  const action = useActionData<typeof action>();

  return (
    <main style={{ maxWidth: 1180, margin: "0 auto", padding: "32px 24px 60px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 28 }}>
        <div style={{ width: 38, height: 38, borderRadius: 10, background: "#111", color: "#fff", display: "grid", placeItems: "center", fontWeight: 800 }}>T</div>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, letterSpacing: "-0.04em" }}>Telence</h1>
          <div style={{ color: "#6d7175", fontSize: 13 }}>Identity & conversion intelligence</div>
        </div>
      </div>

      <section style={{ ...card, background: "#111", color: "white", marginBottom: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 24, alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 12, color: "#a8a8a8", marginBottom: 8 }}>TELENCE BRAIN</div>
            <h2 style={{ margin: 0, fontSize: 26, letterSpacing: "-0.04em" }}>Connect every customer signal.</h2>
            <p style={{ color: "#aaa", maxWidth: 650, lineHeight: 1.55, marginBottom: 0 }}>
              Storefront identity, Shopify carts, checkout tokens, customer data and paid-media signals are resolved into one durable graph.
            </p>
          </div>
          <div style={{ width: 86, height: 86, border: "1px solid #333", borderRadius: 20, display: "grid", placeItems: "center", fontSize: 34 }}>🧠</div>
        </div>
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 16 }}>
        <div style={card}><div style={{ color: "#6d7175", fontSize: 12 }}>Events ingested</div><strong style={{ fontSize: 26 }}>{data.events}</strong></div>
        <div style={card}><div style={{ color: "#6d7175", fontSize: 12 }}>Shopify order receipts</div><strong style={{ fontSize: 26 }}>{data.orders}</strong></div>
        <div style={card}><div style={{ color: "#6d7175", fontSize: 12 }}>Web Pixel</div><strong style={{ fontSize: 18, color: data.active ? "#008060" : "#8c5b00" }}>{data.active ? "Active" : "Not active"}</strong></div>
      </div>

      <section style={card}>
        <h2 style={{ marginTop: 0 }}>Shopify connection</h2>
        <p style={{ color: "#6d7175" }}>Store: <strong>{data.shop}</strong></p>
        <p style={{ color: "#6d7175", lineHeight: 1.5 }}>
          The App Proxy handles first-hop storefront events. The Telence Web Pixel handles checkout/customer events after Shopify's consent rules permit it.
        </p>
        {!data.active && (
          <Form method="post">
            <input type="hidden" name="intent" value="activate_pixel" />
            <button type="submit" style={{ border: 0, borderRadius: 8, padding: "10px 14px", background: "#111", color: "white", fontWeight: 700, cursor: "pointer" }}>
              Enable Telence Web Pixel
            </button>
          </Form>
        )}
        {data.active && <div style={{ color: "#008060", fontWeight: 700 }}>Tracking extension connected.</div>}
        {action && !action.ok && <p style={{ color: "#b42318" }}>{action.error}</p>}
        {action && action.ok && <p style={{ color: "#008060" }}>Web Pixel ready: {action.webPixelId}</p>}
      </section>
    </main>
  );
}
