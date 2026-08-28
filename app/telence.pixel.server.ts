import { randomBytes } from "node:crypto";
import db from "./db.server";

type AdminGraphqlContext = {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

type WebPixelResult = {
  id: string;
  settings?: unknown;
};

function pixelEndpoint() {
  if (process.env.TELENCE_PIXEL_ENDPOINT) return process.env.TELENCE_PIXEL_ENDPOINT;

  const appUrl = process.env.SHOPIFY_APP_URL;
  if (process.env.NODE_ENV !== "production" && appUrl) {
    try {
      return new URL("/pixel/e", appUrl).toString();
    } catch {
      // Fall through to the production hostname.
    }
  }

  return "https://d.telence.com/pixel/e";
}

async function getCurrentWebPixel(admin: AdminGraphqlContext): Promise<WebPixelResult | null> {
  const response = await admin.graphql(`#graphql
    query TelenceCurrentWebPixel {
      webPixel {
        id
        settings
      }
    }
  `);

  const json = (await response.json()) as {
    data?: { webPixel?: WebPixelResult | null };
    errors?: Array<{ message?: string }>;
  };

  if (json.errors?.length) {
    throw new Error(json.errors.map((error) => error.message || "GraphQL error").join("; "));
  }

  return json.data?.webPixel ?? null;
}

export async function ensureTelenceWebPixel(admin: AdminGraphqlContext, shop: string) {
  let installation = await db.shopInstallation.upsert({
    where: { shop },
    update: { uninstalledAt: null },
    create: { shop },
  });

  const publicPixelKey = installation.publicPixelKey || randomBytes(24).toString("hex");
  if (!installation.publicPixelKey) {
    installation = await db.shopInstallation.update({
      where: { shop },
      data: { publicPixelKey },
    });
  }

  const settings = {
    endpoint: pixelEndpoint(),
    publicKey: publicPixelKey,
  };

  const existingPixel = await getCurrentWebPixel(admin);

  if (existingPixel) {
    const response = await admin.graphql(
      `#graphql
        mutation TelenceWebPixelUpdate($id: ID!, $webPixel: WebPixelInput!) {
          webPixelUpdate(id: $id, webPixel: $webPixel) {
            webPixel { id settings }
            userErrors { field message code }
          }
        }
      `,
      { variables: { id: existingPixel.id, webPixel: { settings } } },
    );

    const json = (await response.json()) as {
      data?: {
        webPixelUpdate?: {
          webPixel?: WebPixelResult | null;
          userErrors?: Array<{ message: string }>;
        };
      };
      errors?: Array<{ message?: string }>;
    };

    const userErrors = json.data?.webPixelUpdate?.userErrors || [];
    if (json.errors?.length || userErrors.length) {
      throw new Error([
        ...(json.errors || []).map((error) => error.message || "GraphQL error"),
        ...userErrors.map((error) => error.message),
      ].join("; "));
    }

    const webPixelId = json.data?.webPixelUpdate?.webPixel?.id || existingPixel.id;
    await db.shopInstallation.update({ where: { shop }, data: { webPixelId } });
    return { webPixelId, created: false, endpoint: settings.endpoint };
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
    { variables: { webPixel: { settings } } },
  );

  const json = (await response.json()) as {
    data?: {
      webPixelCreate?: {
        webPixel?: WebPixelResult | null;
        userErrors?: Array<{ message: string }>;
      };
    };
    errors?: Array<{ message?: string }>;
  };

  const userErrors = json.data?.webPixelCreate?.userErrors || [];
  if (json.errors?.length || userErrors.length) {
    throw new Error([
      ...(json.errors || []).map((error) => error.message || "GraphQL error"),
      ...userErrors.map((error) => error.message),
    ].join("; "));
  }

  const webPixelId = json.data?.webPixelCreate?.webPixel?.id;
  if (!webPixelId) throw new Error("Shopify did not return a Web Pixel ID.");

  await db.shopInstallation.update({ where: { shop }, data: { webPixelId } });
  return { webPixelId, created: true, endpoint: settings.endpoint };
}
