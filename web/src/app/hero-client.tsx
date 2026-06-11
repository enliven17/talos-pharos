"use client";

import { useEffect, useRef } from "react";

interface Palette {
  bg: string;
  base: [number, number, number]; // muted text RGB
  peak: [number, number, number]; // accent RGB (pink)
}

const LIGHT_PALETTE: Palette = {
  bg: "#FCF8F8",
  base: [142, 131, 131],
  peak: [245, 175, 175],
};

const DARK_PALETTE: Palette = {
  bg: "#0F0D0D",
  base: [180, 160, 160],
  peak: [245, 175, 175],
};

function readPalette(): Palette {
  if (typeof document === "undefined") return LIGHT_PALETTE;
  return document.documentElement.dataset.theme === "dark"
    ? DARK_PALETTE
    : LIGHT_PALETTE;
}

export function HeroClient() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const paletteRef = useRef<Palette>(LIGHT_PALETTE);

  useEffect(() => {
    paletteRef.current = readPalette();

    // Re-read the palette whenever ThemeToggle flips the html data-theme attr.
    const observer = new MutationObserver(() => {
      paletteRef.current = readPalette();
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    const canvas = canvasRef.current;
    if (!canvas) return () => observer.disconnect();
    const ctx = canvas.getContext("2d");
    if (!ctx) return () => observer.disconnect();

    const dpr = window.devicePixelRatio || 1;
    const chars = ".:-=+*#%@";
    const fontSize = 14;

    let W = 0;
    let H = 0;
    let cols = 0;
    let rows = 0;

    function resize() {
      const rect = canvas!.getBoundingClientRect();
      W = rect.width;
      H = rect.height;
      canvas!.width = W * dpr;
      canvas!.height = H * dpr;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.floor(W / (fontSize * 0.6));
      rows = Math.floor(H / fontSize);
    }

    resize();
    window.addEventListener("resize", resize);

    let frame = 0;
    let animId: number;

    function draw() {
      const palette = paletteRef.current;
      ctx!.fillStyle = palette.bg;
      ctx!.fillRect(0, 0, W, H);
      ctx!.font = `${fontSize}px monospace`;

      const [br, bgc, bb] = palette.base;
      const [pr, pg, pb] = palette.peak;

      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const cx = x / cols - 0.5;
          const cy = y / rows - 0.5;
          const dist = Math.sqrt(cx * cx + cy * cy);
          const wave = Math.sin(dist * 12 - frame * 0.03) * 0.5 + 0.5;
          const noise =
            Math.sin(x * 0.3 + frame * 0.01) *
            Math.cos(y * 0.3 + frame * 0.02);
          const val = wave * 0.7 + noise * 0.3;
          const idx = Math.floor(
            Math.max(0, Math.min(1, val)) * (chars.length - 1)
          );

          const alpha = 0.2 + val * 0.4;
          // Blend pink accent into regions near wave peaks
          const pinkMix = Math.max(0, wave - 0.6) * 2.5; // 0..1 at wave peaks
          const r = Math.round(br * (1 - pinkMix) + pr * pinkMix);
          const g = Math.round(bgc * (1 - pinkMix) + pg * pinkMix);
          const b = Math.round(bb * (1 - pinkMix) + pb * pinkMix);
          ctx!.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
          ctx!.fillText(chars[idx], x * fontSize * 0.6, y * fontSize + fontSize);
        }
      }
      frame++;
      animId = requestAnimationFrame(draw);
    }

    draw();
    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", resize);
      observer.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full opacity-60"
    />
  );
}
