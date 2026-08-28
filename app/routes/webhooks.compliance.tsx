import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  console.log(`[Telence privacy webhook] ${topic} for ${shop}`);
  // TODO before App Store release: implement data export/redaction against the
  // Telence identity graph and retention policy. For development we authenticate
  // and acknowledge the mandatory Shopify privacy topics.
  return new Response();
};
