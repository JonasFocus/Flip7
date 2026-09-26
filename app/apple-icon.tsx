import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#0c0d1d" }}>
        <div
          style={{
            width: 88,
            height: 122,
            borderRadius: 16,
            background: "#f4dc3a",
            boxShadow: "0 8px 0 0 #8a7a1f",
            transform: "rotate(8deg)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 84,
            fontWeight: 900,
            color: "#15172b",
          }}
        >
          7
        </div>
      </div>
    ),
    size,
  );
}
