import { ImageResponse } from "next/og";

// The link-preview card (iMessage, Slack, etc.): says "Game Time!" instead of the app name.
export function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "radial-gradient(circle at 50% 40%, #1d2150 0%, #080a18 70%)",
          color: "#f4dc3a",
          fontSize: 190,
          fontWeight: 900,
          letterSpacing: -4,
          textShadow: "0 12px 0 #8a7a1f",
        }}
      >
        Game Time!
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
