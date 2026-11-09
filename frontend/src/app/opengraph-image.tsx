import { ImageResponse } from "next/og";

export const alt = "ToProt: Research Protocol & Study Design Platform";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: 80,
          background: "#112D35",
          color: "#F6F8F7",
        }}
      >
        <div style={{ fontSize: 96, fontWeight: 700 }}>ToProt</div>
        <div style={{ marginTop: 24, fontSize: 44, color: "#DCE8E4" }}>From research protocol to research-ready documents.</div>
        <div style={{ marginTop: 48, width: 160, height: 6, background: "#C58A36" }} />
      </div>
    ),
    size,
  );
}
