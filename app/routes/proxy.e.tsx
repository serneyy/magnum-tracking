import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

function firstIp(value: string | null) {
  return value?.split(",")[0]?.trim() || null;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const context = await authenticate.public.appProxy(request);
  const url = new URL(request.url);
  const shop = context.session?.shop || url.searchParams.get("shop");
  if (!shop) return new Response("Unauthorized", { status: 401 });

  let payload: any;
  try {
    payload = JSON.parse(await request.text());
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  await db.ingestEvent.create({
    data: {
      shop,
      source: "shopify_app_proxy",
      eventName: payload?.event?.name || null,
      visitorId: payload?.identity?.tl_visitor_id || null,
      sessionId: payload?.identity?.tl_session_id || null,
      cartToken: payload?.identity?.cart_token || payload?.event?.cart?.token || null,
      checkoutToken: payload?.identity?.checkout_token || null,
      clientIp: firstIp(request.headers.get("x-forwarded-for")),
      userAgent: payload?.event?.user_agent || request.headers.get("user-agent"),
      payload,
      occurredAt: payload?.sent_at ? new Date(payload.sent_at) : null,
    },
  });

  return new Response(null, { status: 202 });
};
