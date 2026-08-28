import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return null;
};

export default function TelenceEntry() {
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#0b0b0c", color: "#fff", fontFamily: "Inter, system-ui, sans-serif" }}>
      <div style={{ textAlign: "center", maxWidth: 520, padding: 32 }}>
        <div style={{ fontSize: 13, letterSpacing: "0.16em", color: "#8c8c92", marginBottom: 14 }}>TELENCE</div>
        <h1 style={{ margin: 0, fontSize: 34, letterSpacing: "-0.05em" }}>Identity intelligence for commerce.</h1>
        <p style={{ color: "#929299", lineHeight: 1.6 }}>
          Open Telence from Shopify Admin, or start the development app with Shopify CLI.
        </p>
      </div>
    </main>
  );
}
