import { randomBytes } from "node:crypto";
import { useEffect } from "react";
import type { CSSProperties } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useRevalidator } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

const TELENCE_LOGO_URL = "https://cdn.shopify.com/s/files/1/0685/9060/0494/files/m_2.jpg?v=1787914555";

type ActionData =
  | { ok: true; webPixelId: string; alreadyActive?: boolean }
  | { ok: false; error: string };

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function hasSignal(payload: unknown, key: string) {
  const root = asRecord(payload);
  const identity = asRecord(root.identity);
  const event = asRecord(root.event);
  const customer = asRecord(event.customer);
  const checkout = asRecord(event.checkout);
  return Boolean(identity[key] ?? root[key] ?? event[key] ?? customer[key] ?? checkout[key]);
}

function pct(value: number, total: number) {
  if (!total) return 0;
  return Math.round((value / total) * 100);
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const now = Date.now();
  const fiveMinutesAgo = new Date(now - 5 * 60 * 1000);
  const dayAgo = new Date(now - 24 * 60 * 60 * 1000);

  const [
    installation,
    totalEvents,
    events5m,
    events24h,
    totalOrders,
    orders24h,
    proxyEvents,
    pixelEvents,
    recentEvents,
    signalSample,
  ] = await Promise.all([
    db.shopInstallation.findUnique({ where: { shop: session.shop } }),
    db.ingestEvent.count({ where: { shop: session.shop } }),
    db.ingestEvent.count({ where: { shop: session.shop, receivedAt: { gte: fiveMinutesAgo } } }),
    db.ingestEvent.count({ where: { shop: session.shop, receivedAt: { gte: dayAgo } } }),
    db.shopifyOrderReceipt.count({ where: { shop: session.shop } }),
    db.shopifyOrderReceipt.count({ where: { shop: session.shop, receivedAt: { gte: dayAgo } } }),
    db.ingestEvent.count({ where: { shop: session.shop, source: "shopify_app_proxy" } }),
    db.ingestEvent.count({ where: { shop: session.shop, source: "shopify_web_pixel" } }),
    db.ingestEvent.findMany({
      where: { shop: session.shop },
      orderBy: { receivedAt: "desc" },
      take: 36,
      select: {
        id: true,
        source: true,
        eventName: true,
        visitorId: true,
        sessionId: true,
        cartToken: true,
        checkoutToken: true,
        payload: true,
        receivedAt: true,
      },
    }),
    db.ingestEvent.findMany({
      where: { shop: session.shop },
      orderBy: { receivedAt: "desc" },
      take: 250,
      select: {
        visitorId: true,
        cartToken: true,
        checkoutToken: true,
        payload: true,
      },
    }),
  ]);

  const visitors = new Set(signalSample.map((event) => event.visitorId).filter(Boolean)).size;
  const carts = signalSample.filter((event) => Boolean(event.cartToken)).length;
  const checkouts = signalSample.filter((event) => Boolean(event.checkoutToken)).length;
  const fbc = signalSample.filter((event) => hasSignal(event.payload, "fbc")).length;
  const fbp = signalSample.filter((event) => hasSignal(event.payload, "fbp")).length;
  const sampleSize = signalSample.length;

  return {
    shop: session.shop,
    active: Boolean(installation?.webPixelId),
    webPixelId: installation?.webPixelId ?? null,
    stats: {
      totalEvents,
      events5m,
      events24h,
      totalOrders,
      orders24h,
      proxyEvents,
      pixelEvents,
      visitors,
      carts,
      checkouts,
      fbcCoverage: pct(fbc, sampleSize),
      fbpCoverage: pct(fbp, sampleSize),
      sampleSize,
    },
    recentEvents: recentEvents.map((event) => ({
      id: event.id,
      source: event.source,
      eventName: event.eventName || "event",
      visitor: Boolean(event.visitorId),
      session: Boolean(event.sessionId),
      cart: Boolean(event.cartToken),
      checkout: Boolean(event.checkoutToken),
      fbc: hasSignal(event.payload, "fbc"),
      fbp: hasSignal(event.payload, "fbp"),
      receivedAt: event.receivedAt.toISOString(),
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionData> => {
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
            publicKey: publicPixelKey,
          },
        },
      },
    },
  );

  const json = await response.json() as {
    data?: {
      webPixelCreate?: {
        webPixel?: { id?: string } | null;
        userErrors?: Array<{ message: string }>;
      };
    };
  };
  const result = json.data?.webPixelCreate;
  if (result?.userErrors?.length) {
    return { ok: false, error: result.userErrors.map((error) => error.message).join("; ") };
  }

  const webPixelId = result?.webPixel?.id;
  if (!webPixelId) return { ok: false, error: "Shopify did not return a Web Pixel ID." };

  await db.shopInstallation.update({
    where: { shop: session.shop },
    data: { webPixelId },
  });

  return { ok: true, webPixelId };
};

const card: CSSProperties = {
  background: "#fff",
  border: "1px solid #e7e7e7",
  borderRadius: 14,
};

const smallLabel: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: "#747474",
  textTransform: "uppercase",
  letterSpacing: ".08em",
};

function Stat({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return (
    <div style={{ ...card, padding: 18, minHeight: 92 }}>
      <div style={smallLabel}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 750, letterSpacing: "-0.045em", marginTop: 8 }}>{value}</div>
      {note && <div style={{ fontSize: 12, color: "#8a8a8a", marginTop: 4 }}>{note}</div>}
    </div>
  );
}

function SignalDot({ ok }: { ok: boolean }) {
  return <span style={{ width: 7, height: 7, borderRadius: "50%", background: ok ? "#25d366" : "#d5d5d5", display: "inline-block" }} />;
}

export default function Home() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData() as ActionData | undefined;
  const revalidator = useRevalidator();
  const trackingLive = data.stats.events5m > 0;

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && revalidator.state === "idle") {
        void revalidator.revalidate();
      }
    }, 4000);
    return () => window.clearInterval(timer);
  }, [revalidator]);

  return (
    <main style={{ maxWidth: 1240, margin: "0 auto", padding: "28px 24px 64px", color: "#111" }}>
      <style>{`
        @keyframes telencePulse { 0%,100% { opacity:.45; transform:scale(.92) } 50% { opacity:1; transform:scale(1.08) } }
        @keyframes telenceRing { 0% { transform:scale(.82); opacity:.55 } 100% { transform:scale(1.35); opacity:0 } }
        @media (max-width: 820px) {
          .tl-brain-grid { grid-template-columns: 1fr !important; }
          .tl-stat-grid { grid-template-columns: repeat(2, minmax(0,1fr)) !important; }
          .tl-stream-head, .tl-stream-row { grid-template-columns: 1.3fr .8fr .7fr !important; }
          .tl-hide-mobile { display:none !important; }
        }
      `}</style>

      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20, marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <img src={TELENCE_LOGO_URL} alt="Telence" width={38} height={38} style={{ width: 38, height: 38, borderRadius: 9, objectFit: "cover" }} />
          <div>
            <div style={{ fontSize: 21, fontWeight: 760, letterSpacing: "-0.035em" }}>Telence</div>
            <div style={{ color: "#858585", fontSize: 12 }}>{data.shop}</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 650 }}>
          <span style={{ position: "relative", width: 9, height: 9 }}>
            {trackingLive && <span style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "#2fd36b", animation: "telencePulse 1.5s infinite" }} />}
            <span style={{ position: "absolute", inset: 1, borderRadius: "50%", background: trackingLive ? "#25d366" : "#b8b8b8" }} />
          </span>
          {trackingLive ? "Tracking live" : "Waiting for signals"}
        </div>
      </header>

      <section className="tl-brain-grid" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.15fr) minmax(380px, .85fr)", background: "#080808", color: "#fff", borderRadius: 18, overflow: "hidden", marginBottom: 14, minHeight: 310 }}>
        <div style={{ minHeight: 310, display: "grid", placeItems: "center", position: "relative", borderRight: "1px solid #202020" }}>
          <div style={{ position: "absolute", top: 22, left: 24, ...smallLabel, color: "#777" }}>TELENCE BRAIN</div>
          <div style={{ position: "relative", width: 190, height: 190, display: "grid", placeItems: "center" }}>
            {trackingLive && <div style={{ position: "absolute", width: 152, height: 152, borderRadius: "50%", border: "1px solid rgba(70,255,135,.65)", animation: "telenceRing 2s ease-out infinite" }} />}
            <div style={{ position: "absolute", width: 154, height: 154, borderRadius: 34, background: trackingLive ? "rgba(45,211,102,.08)" : "rgba(255,255,255,.025)", filter: "blur(8px)" }} />
            <img
              src={TELENCE_LOGO_URL}
              alt="Telence Brain"
              width={142}
              height={142}
              style={{ width: 142, height: 142, objectFit: "cover", borderRadius: 28, boxShadow: trackingLive ? "0 0 42px rgba(47,211,107,.14)" : "none", animation: trackingLive ? "telencePulse 2.4s ease-in-out infinite" : "none" }}
            />
          </div>
          <div style={{ position: "absolute", bottom: 22, left: 24, right: 24, display: "flex", justifyContent: "space-between", color: "#777", fontSize: 11 }}>
            <span>IDENTITY GRAPH</span>
            <span>{trackingLive ? "PROCESSING SIGNALS" : "STANDBY"}</span>
          </div>
        </div>

        <div style={{ padding: "28px 30px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <div style={{ color: "#737373", fontSize: 11, fontWeight: 700, letterSpacing: ".08em", marginBottom: 18 }}>LIVE SIGNAL HEALTH</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "18px 24px" }}>
            <div><div style={{ color: "#777", fontSize: 11 }}>EVENTS · 5 MIN</div><div style={{ fontSize: 34, fontWeight: 760, letterSpacing: "-.05em", marginTop: 3 }}>{data.stats.events5m}</div></div>
            <div><div style={{ color: "#777", fontSize: 11 }}>EVENTS · 24 H</div><div style={{ fontSize: 34, fontWeight: 760, letterSpacing: "-.05em", marginTop: 3 }}>{data.stats.events24h}</div></div>
            <div><div style={{ color: "#777", fontSize: 11 }}>VISITORS · SAMPLE</div><div style={{ fontSize: 25, fontWeight: 700, marginTop: 5 }}>{data.stats.visitors}</div></div>
            <div><div style={{ color: "#777", fontSize: 11 }}>ORDERS · 24 H</div><div style={{ fontSize: 25, fontWeight: 700, marginTop: 5 }}>{data.stats.orders24h}</div></div>
          </div>
          <div style={{ height: 1, background: "#242424", margin: "22px 0 18px" }} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, fontSize: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}><SignalDot ok={data.stats.proxyEvents > 0} /> Storefront proxy <strong style={{ marginLeft: "auto" }}>{data.stats.proxyEvents}</strong></div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}><SignalDot ok={data.stats.pixelEvents > 0} /> Checkout pixel <strong style={{ marginLeft: "auto" }}>{data.stats.pixelEvents}</strong></div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}><SignalDot ok={data.stats.fbcCoverage > 0} /> fbc coverage <strong style={{ marginLeft: "auto" }}>{data.stats.fbcCoverage}%</strong></div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}><SignalDot ok={data.stats.fbpCoverage > 0} /> fbp coverage <strong style={{ marginLeft: "auto" }}>{data.stats.fbpCoverage}%</strong></div>
          </div>
        </div>
      </section>

      <div className="tl-stat-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12, marginBottom: 14 }}>
        <Stat label="Total events" value={data.stats.totalEvents.toLocaleString()} />
        <Stat label="Orders received" value={data.stats.totalOrders.toLocaleString()} />
        <Stat label="Cart signals" value={data.stats.carts} note={`last ${data.stats.sampleSize} events`} />
        <Stat label="Checkout signals" value={data.stats.checkouts} note={`last ${data.stats.sampleSize} events`} />
      </div>

      <section style={{ ...card, overflow: "hidden", marginBottom: 14 }}>
        <div style={{ padding: "17px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #ededed" }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 720 }}>Live event stream</div>
            <div style={{ fontSize: 11, color: "#8b8b8b", marginTop: 2 }}>Auto-refreshes every 4 seconds while this page is open</div>
          </div>
          <div style={{ fontSize: 11, color: revalidator.state === "loading" ? "#111" : "#969696" }}>{revalidator.state === "loading" ? "Refreshing…" : "Live"}</div>
        </div>

        <div className="tl-stream-head" style={{ display: "grid", gridTemplateColumns: "1.5fr .85fr .75fr 1.25fr .75fr", padding: "9px 18px", background: "#fafafa", borderBottom: "1px solid #ededed", ...smallLabel, fontSize: 9 }}>
          <span>Event</span><span>Route</span><span>Time</span><span className="tl-hide-mobile">Identity</span><span className="tl-hide-mobile">Meta</span>
        </div>

        {data.recentEvents.length === 0 ? (
          <div style={{ padding: "42px 18px", textAlign: "center", color: "#777" }}>
            <div style={{ fontWeight: 680, color: "#333" }}>No signals yet</div>
            <div style={{ fontSize: 12, marginTop: 6 }}>Open your development storefront, browse a product and add it to cart. Events will appear here.</div>
          </div>
        ) : data.recentEvents.map((event) => {
          const time = new Date(event.receivedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
          const route = event.source === "shopify_app_proxy" ? "PROXY" : event.source === "shopify_web_pixel" ? "PIXEL" : event.source.toUpperCase();
          const identityCount = [event.visitor, event.session, event.cart, event.checkout].filter(Boolean).length;
          return (
            <div key={event.id} className="tl-stream-row" style={{ display: "grid", gridTemplateColumns: "1.5fr .85fr .75fr 1.25fr .75fr", padding: "12px 18px", alignItems: "center", borderBottom: "1px solid #f1f1f1", fontSize: 12 }}>
              <div style={{ fontWeight: 650 }}>{event.eventName}</div>
              <div><span style={{ padding: "4px 7px", borderRadius: 5, background: route === "PROXY" ? "#f0f0f0" : "#111", color: route === "PROXY" ? "#444" : "#fff", fontSize: 9, fontWeight: 750 }}>{route}</span></div>
              <div style={{ color: "#757575", fontVariantNumeric: "tabular-nums" }}>{time}</div>
              <div className="tl-hide-mobile" style={{ color: "#666" }}>{identityCount}/4 signals {event.checkout ? "· checkout" : event.cart ? "· cart" : event.visitor ? "· visitor" : ""}</div>
              <div className="tl-hide-mobile" style={{ display: "flex", gap: 8, alignItems: "center" }}><span style={{ color: event.fbc ? "#15803d" : "#aaa" }}>fbc {event.fbc ? "✓" : "–"}</span><span style={{ color: event.fbp ? "#15803d" : "#aaa" }}>fbp {event.fbp ? "✓" : "–"}</span></div>
            </div>
          );
        })}
      </section>

      <section style={{ ...card, padding: 18, display: "flex", gap: 22, justifyContent: "space-between", alignItems: "center", flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>Shopify connection</div>
          <div style={{ color: "#777", fontSize: 12, marginTop: 4 }}>App Proxy collects storefront signals. Telence Web Pixel enriches checkout identity when Shopify privacy rules permit it.</div>
        </div>
        {!data.active ? (
          <Form method="post">
            <input type="hidden" name="intent" value="activate_pixel" />
            <button type="submit" style={{ border: 0, borderRadius: 8, padding: "10px 14px", background: "#111", color: "white", fontWeight: 700, cursor: "pointer" }}>Enable Telence Web Pixel</button>
          </Form>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 7, color: "#15803d", fontSize: 12, fontWeight: 700 }}><SignalDot ok /> Web Pixel active</div>
        )}
        {actionData && !actionData.ok && <div style={{ width: "100%", color: "#b42318", fontSize: 12 }}>{actionData.error}</div>}
        {actionData?.ok && <div style={{ width: "100%", color: "#15803d", fontSize: 12 }}>Web Pixel ready: {actionData.webPixelId}</div>}
      </section>
    </main>
  );
}
