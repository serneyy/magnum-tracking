import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session } = await authenticate.webhook(request);
  if (session) await db.session.deleteMany({ where: { shop } });
  await db.shopInstallation.upsert({
    where: { shop },
    update: { uninstalledAt: new Date() },
    create: { shop, uninstalledAt: new Date() },
  });
  return new Response();
};
