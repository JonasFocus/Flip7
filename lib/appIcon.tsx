import { ImageResponse } from "next/og";

// The home-screen icon: the yellow "GT" monogram on deep ink. `maskable` shrinks it into the
// 80% safe zone so Android's circle/squircle masks never clip it.
export function appIcon(px: number, maskable = false): ImageResponse {
  const k = (px / 180) * (maskable ? 0.72 : 1);
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#080a18" }}>
        <div style={{ display: "flex", fontSize: 92 * k, fontWeight: 900, letterSpacing: -4 * k, color: "#f4dc3a", textShadow: `0 ${8 * k}px 0 #8a7a1f` }}>GT</div>
      </div>
    ),
    { width: px, height: px },
  );
}
