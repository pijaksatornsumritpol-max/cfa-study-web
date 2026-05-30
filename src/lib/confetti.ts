// Lightweight canvas confetti — no dependencies, client-only.
// "Make it satisfying": fire an immediate reward when a habit goal is hit.

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  size: number;
  color: string;
}

const COLORS = ["#4f46e5", "#10b981", "#f59e0b", "#ef4444", "#3b82f6", "#ec4899"];

export function celebrate(opts?: { particles?: number }): void {
  if (typeof window === "undefined") return;
  const count = opts?.particles ?? 150;

  const canvas = document.createElement("canvas");
  canvas.style.cssText =
    "position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:9999";
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    canvas.remove();
    return;
  }

  const parts: Particle[] = [];
  for (let i = 0; i < count; i++) {
    parts.push({
      x: window.innerWidth / 2 + (Math.random() - 0.5) * 240,
      y: window.innerHeight * 0.32 + (Math.random() - 0.5) * 80,
      vx: (Math.random() - 0.5) * 13,
      vy: Math.random() * -13 - 4,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      size: Math.random() * 6 + 4,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
    });
  }

  const gravity = 0.35;
  const duration = 2600;
  const start = performance.now();

  function frame(now: number) {
    const elapsed = now - start;
    ctx!.clearRect(0, 0, canvas.width, canvas.height);
    for (const p of parts) {
      p.vy += gravity;
      p.vx *= 0.99;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      ctx!.save();
      ctx!.translate(p.x, p.y);
      ctx!.rotate(p.rot);
      ctx!.globalAlpha = Math.max(0, 1 - elapsed / duration);
      ctx!.fillStyle = p.color;
      ctx!.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      ctx!.restore();
    }
    if (elapsed < duration) requestAnimationFrame(frame);
    else canvas.remove();
  }
  requestAnimationFrame(frame);
}
