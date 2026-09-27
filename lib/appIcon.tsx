import { ImageResponse } from "next/og";

// The home-screen icon: the yellow "7" card on deep ink. `maskable` shrinks the card into the
// 80% safe zone so Android's circle/squircle masks never clip it.
export function appIcon(px: number, maskable = false): ImageResponse {
  const k = (px / 180) * (maskable ? 0.72 : 1);
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#080a18" }}>
        <div
          style={{
            width: 88 * k,
            height: 122 * k,
            borderRadius: 16 * k,
            background: "#f4dc3a",
            boxShadow: `0 ${8 * k}px 0 0 #8a7a1f`,
            transform: "rotate(8deg)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 84 * k,
            fontWeight: 900,
            color: "#15172b",
          }}
        >
          7
        </div>
      </div>
    ),
    { width: px, height: px },
  );
}
