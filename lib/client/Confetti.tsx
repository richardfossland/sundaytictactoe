"use client";

import { useEffect, useRef } from "react";

// Lightweight canvas confetti — no dependencies. Fires a celebratory burst in
// the suite's gold/cream palette, then fades. Used on the podium + student win.
const COLORS = ["#ebb84b", "#f6dd97", "#faf7f0", "#d4a23a", "#ffffff"];

export function Confetti({ count = 140 }: { count?: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = (canvas.width = window.innerWidth * dpr);
    const H = (canvas.height = window.innerHeight * dpr);

    type P = {
      x: number;
      y: number;
      vx: number;
      vy: number;
      rot: number;
      vr: number;
      w: number;
      h: number;
      color: string;
    };
    const parts: P[] = Array.from({ length: count }, () => ({
      x: W * (0.5 + (Math.sin(count) || 0) * 0) + (Math.random() - 0.5) * W * 0.5,
      y: -Math.random() * H * 0.3,
      vx: (Math.random() - 0.5) * 10 * dpr,
      vy: (2 + Math.random() * 5) * dpr,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      w: (6 + Math.random() * 7) * dpr,
      h: (8 + Math.random() * 10) * dpr,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
    }));

    let frame = 0;
    let raf = 0;
    const tick = () => {
      frame++;
      ctx.clearRect(0, 0, W, H);
      const fade = Math.max(0, 1 - frame / 200);
      for (const p of parts) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.12 * dpr;
        p.vx *= 0.99;
        p.rot += p.vr;
        ctx.save();
        ctx.globalAlpha = fade;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      if (frame < 200) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [count]);

  return (
    <canvas
      ref={ref}
      aria-hidden
      style={{
        position: "fixed",
        inset: 0,
        width: "100vw",
        height: "100dvh",
        pointerEvents: "none",
        zIndex: 70,
      }}
    />
  );
}

/** Up-to-2-char initials for avatar bubbles. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
