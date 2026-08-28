import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};

export const loader = async ({ request }: ActionFunctionArgs) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  return new Response("Method not allowed", { status: 405, headers: cors });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  let payload: any;
  try {
    payload = JSON.parse(await request.text());
  } catch {
    return new Response("Invalid JSON", { status: 400, headers: cors });
  }

  const publicPixelKey = payload?.pixel_key;
  if (!publicPixelKey) return new Response("Unauthorized", { status: 401, headers: cors });

  const installation = await db.shopInstallation.findUnique({ where: { publicPixelKey } });
  if (!installation || installation.uninstalledAt) {
    return new Response("Unauthorized", { status: 401, headers: cors });
  }

  await db.ingestEvent.create({
    data: {
      shop: installation.shop,
      source: "shopify_web_pixel",
      eventName: payload?.event?.name || null,
      visitorId: payload?.identity?.tl_visitor_id || null,
      sessionId: payload?.identity?.tl_session_id || null,
      cartToken: payload?.identity?.cart_token || null,
      checkoutToken: payload?.identity?.checkout_token || payload?.event?.checkout?.checkout_token || null,
      userAgent: payload?.event?.user_agent || null,
      payload,
      occurredAt: payload?.sent_at ? new Date(payload.sent_at) : null,
    },
  });

  return new Response(null, { status: 202, headers: cors });
};
