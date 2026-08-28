import type { Prisma } from "@prisma/client";
import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  const body = payload as Record<string, unknown>;
  const orderId = body?.id == null ? null : String(body.id);

  await db.shopifyOrderReceipt.create({
    data: {
      shop,
      topic,
      shopifyOrderId: orderId,
      payload: body as Prisma.InputJsonValue,
    },
  });

  return new Response();
};
