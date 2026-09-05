import React, { useEffect, useRef } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, random } from "remotion";

export type ThemeName = "saffron" | "teal" | "gold" | "heritage";

const THEME_COLORS: Record<ThemeName, { a: string; b: string; c: string; grain: string }> = {
  saffron: { a: "#1b120b", b: "#2a1810", c: "#3d2214", grain: "#c9722c" },
  teal: { a: "#0c1815", b: "#12241f", c: "#193631", grain: "#3fa389" },
  gold: { a: "#171207", b: "#241d0d", c: "#332711", grain: "#d3ab52" },
  // Reserved for "On This Day" history content — a deep maroon/burgundy,
  // visually distinct from the sector-video theme rotation (saffron/teal/
  // gold) so the carousel format reads as its own consistent series.
  heritage: { a: "#150a0d", b: "#241019", c: "#361525", grain: "#b8567a" },
};

// Generative dark backdrop: soft diagonal gradient wash + slow-drifting
// grain/dot field + a faint concentric arc motif (nods to a radar / growth-
// ring visual without being a literal chart). Rendered on canvas so the
// texture doesn't rely on hand-authored SVG path data.
export const Background: React.FC<{ theme: ThemeName }> = ({ theme }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const colors = THEME_COLORS[theme];

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = width;
    canvas.height = height;

    const grad = ctx.createLinearGradient(0, 0, width * 0.3, height);
    grad.addColorStop(0, colors.c);
    grad.addColorStop(0.55, colors.b);
    grad.addColorStop(1, colors.a);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    // concentric arcs, off-canvas center bottom-right, slow drift with frame
    const drift = frame * 0.15;
    const cx = width * 1.05;
    const cy = height * 0.92;
    ctx.strokeStyle = colors.grain;
    for (let i = 0; i < 6; i++) {
      const r = 220 + i * 170 + drift;
      ctx.globalAlpha = 0.05 - i * 0.005;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // grain / dot field, deterministic per-frame via remotion's random()
    const dotCount = 90;
    for (let i = 0; i < dotCount; i++) {
      const rx = random(`dot-x-${i}`) * width;
      const ry = random(`dot-y-${i}`) * height;
      const flicker = 0.15 + 0.1 * Math.sin(frame * 0.05 + i);
      const size = 1 + random(`dot-s-${i}`) * 1.6;
      ctx.fillStyle = colors.grain;
      ctx.globalAlpha = Math.max(0, flicker) * 0.35;
      ctx.beginPath();
      ctx.arc(rx, ry, size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // vignette
    const vg = ctx.createRadialGradient(
      width / 2,
      height * 0.4,
      height * 0.2,
      width / 2,
      height * 0.5,
      height * 0.9
    );
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,0.35)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, width, height);
  }, [frame, width, height, colors]);

  return (
    <AbsoluteFill>
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%" }} />
    </AbsoluteFill>
  );
};
