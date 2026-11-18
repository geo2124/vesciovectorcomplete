import { useEffect, useRef, useState } from "react";

const W = 640;
const H = 400;

export type PenMode = "freehand" | "direction" | "screen" | "stamp";

export type Pen = {
  key: string;
  label: string;
  color: string;
  mode: PenMode;
  dashed?: boolean;
  dotted?: boolean;
  stamp?: "cone" | "handoff";
};

const PENS: Pen[] = [
  { key: "offense", label: "Offense", color: "#22d3ee", mode: "freehand" },
  { key: "defense", label: "Defense", color: "#f87171", mode: "freehand" },
  { key: "direction", label: "Direction ➔", color: "#f1f5f9", mode: "direction" },
  { key: "screen", label: "Screen ┫", color: "#38bdf8", mode: "screen" },
  { key: "handoff", label: "Handoff (#)", color: "#fbbf24", mode: "stamp", stamp: "handoff" },
  { key: "ball", label: "Pass", color: "#fbbf24", mode: "freehand", dashed: true },
  { key: "dribble", label: "Dribble", color: "#fbbf24", mode: "freehand", dotted: true },
  { key: "cone", label: "Cone ▲", color: "#f97316", mode: "stamp", stamp: "cone" },
];

function drawCourt(ctx: CanvasRenderingContext2D, sport: string) {
  ctx.save();
  ctx.setLineDash([]);
  ctx.fillStyle = "#0b1220";
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "rgba(148,163,184,0.55)";
  ctx.lineWidth = 2;
  ctx.strokeRect(24, 24, W - 48, H - 48);
  ctx.beginPath();
  ctx.moveTo(W / 2, 24);
  ctx.lineTo(W / 2, H - 24);
  ctx.stroke();

  if (sport === "Volleyball") {
    ctx.setLineDash([6, 6]);
    [W / 2 - 90, W / 2 + 90].forEach((x) => {
      ctx.beginPath();
      ctx.moveTo(x, 24);
      ctx.lineTo(x, H - 24);
      ctx.stroke();
    });
    ctx.restore();
    return;
  }

  ctx.beginPath();
  ctx.arc(W / 2, H / 2, 46, 0, Math.PI * 2);
  ctx.stroke();

  if (sport === "Football") {
    [24, W - 24].forEach((x, i) => {
      const dir = i === 0 ? 1 : -1;
      ctx.strokeRect(x, H / 2 - 80, dir * 90, 160);
      ctx.strokeRect(x, H / 2 - 40, dir * 36, 80);
    });
    ctx.restore();
    return;
  }

  // Basketball
  [24, W - 24].forEach((x, i) => {
    const dir = i === 0 ? 1 : -1;
    ctx.strokeRect(x, H / 2 - 60, dir * 110, 120);
    ctx.beginPath();
    ctx.arc(x + dir * 110, H / 2, 40, 0, Math.PI * 2);
    ctx.stroke();
  });
  ctx.restore();
}

/** Draws an authentic '#' hash symbol for dribble handoffs */
function drawHandoffHash(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size = 14,
  angle = 0,
) {
  ctx.save();
  ctx.translate(cx, cy);
  if (angle !== 0) ctx.rotate(angle);
  ctx.strokeStyle = "#fbbf24";
  ctx.lineWidth = 3;
  ctx.lineCap = "round";

  const span = size;
  const offset = size * 0.42;
  const slant = size * 0.2;

  ctx.beginPath();
  // Two horizontal lines
  ctx.moveTo(-span, -offset);
  ctx.lineTo(span, -offset);
  ctx.moveTo(-span, offset);
  ctx.lineTo(span, offset);

  // Two vertical slanted lines forming the '#'
  ctx.moveTo(-offset + slant, -span);
  ctx.lineTo(-offset - slant, span);
  ctx.moveTo(offset + slant, -span);
  ctx.lineTo(offset - slant, span);

  ctx.stroke();
  ctx.restore();
}

/** Draws athletic cone */
function drawCone(ctx: CanvasRenderingContext2D, cx: number, cy: number, color = "#f97316") {
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(cx, cy - 14);
  ctx.lineTo(cx - 11, cy + 11);
  ctx.lineTo(cx + 11, cy + 11);
  ctx.closePath();
  ctx.fill();

  // Base rim
  ctx.strokeStyle = "rgba(0,0,0,0.3)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
}

/** Draws screen with variable length stem and perpendicular T-bar cap at any 360-degree angle */
function drawScreen(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color = "#38bdf8",
) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx);

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Stem line (approach)
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();

  // Perpendicular T-bar (the screen block) at (x2, y2)
  const barLen = Math.max(16, Math.min(26, 14 + dist * 0.08));
  const perpX = Math.cos(angle + Math.PI / 2);
  const perpY = Math.sin(angle + Math.PI / 2);

  ctx.beginPath();
  ctx.moveTo(x2 - perpX * barLen, y2 - perpY * barLen);
  ctx.lineTo(x2 + perpX * barLen, y2 + perpY * barLen);
  ctx.stroke();
  ctx.restore();
}

/** Draws direction line with arrowhead pointing in whatever direction user dragged */
function drawDirectionArrow(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color = "#f1f5f9",
) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const angle = Math.atan2(dy, dx);
  const headLen = 13;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Shaft
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();

  // Arrow Head at (x2, y2)
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(
    x2 - headLen * Math.cos(angle - Math.PI / 6),
    y2 - headLen * Math.sin(angle - Math.PI / 6),
  );
  ctx.lineTo(
    x2 - headLen * Math.cos(angle + Math.PI / 6),
    y2 - headLen * Math.sin(angle + Math.PI / 6),
  );
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export function DrawingBoard({
  value,
  onChange,
  sport = "Basketball",
}: {
  value: string | null;
  onChange: (dataUrl: string | null) => void;
  sport?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const history = useRef<string[]>([]);
  const drawing = useRef(false);
  const startPoint = useRef<{ x: number; y: number } | null>(null);
  const snapshot = useRef<ImageData | null>(null);
  const initialised = useRef(false);
  const [pen, setPen] = useState<Pen>(PENS[0]!);

  // Paint the court once, then restore any saved drawing on top of it.
  useEffect(() => {
    if (initialised.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx) return;
    initialised.current = true;
    drawCourt(ctx, sport);
    if (value) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, W, H);
      img.src = value;
    }
  }, [sport, value]);

  function ctx2d() {
    return canvasRef.current?.getContext("2d") ?? null;
  }

  function pos(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * W,
      y: ((e.clientY - rect.top) / rect.height) * H,
    };
  }

  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    const ctx = ctx2d();
    const canvas = canvasRef.current;
    if (!ctx || !canvas) return;

    e.currentTarget.setPointerCapture(e.pointerId);
    history.current = [...history.current.slice(-19), canvas.toDataURL("image/png")];
    drawing.current = true;

    const p = pos(e);
    startPoint.current = p;

    // Snapshot background before dragging starts
    try {
      snapshot.current = ctx.getImageData(0, 0, W, H);
    } catch {
      snapshot.current = null;
    }

    if (pen.mode === "freehand") {
      ctx.strokeStyle = pen.color;
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.setLineDash(pen.dashed ? [10, 8] : pen.dotted ? [3, 5] : []);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
    }
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = ctx2d();
    if (!ctx) return;

    const currentPos = pos(e);

    if (pen.mode === "direction" || pen.mode === "screen") {
      // Restore pre-drag snapshot for crisp live preview
      if (snapshot.current) {
        ctx.putImageData(snapshot.current, 0, 0);
      }
      const s = startPoint.current ?? currentPos;
      if (pen.mode === "direction") {
        drawDirectionArrow(ctx, s.x, s.y, currentPos.x, currentPos.y, pen.color);
      } else if (pen.mode === "screen") {
        drawScreen(ctx, s.x, s.y, currentPos.x, currentPos.y, pen.color);
      }
      return;
    }

    if (pen.mode === "stamp") {
      // Live preview stamp position
      if (snapshot.current) {
        ctx.putImageData(snapshot.current, 0, 0);
      }
      if (pen.stamp === "handoff") {
        drawHandoffHash(ctx, currentPos.x, currentPos.y);
      } else if (pen.stamp === "cone") {
        drawCone(ctx, currentPos.x, currentPos.y, pen.color);
      }
      return;
    }

    // Freehand drawing
    ctx.lineTo(currentPos.x, currentPos.y);
    ctx.stroke();
  }

  function end(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    drawing.current = false;
    const ctx = ctx2d();
    const canvas = canvasRef.current;
    if (!ctx || !canvas) return;

    const currentPos = pos(e);
    const s = startPoint.current ?? currentPos;
    const dist = Math.hypot(currentPos.x - s.x, currentPos.y - s.y);

    if (pen.mode === "direction") {
      if (snapshot.current) ctx.putImageData(snapshot.current, 0, 0);
      if (dist < 6) {
        // Clicked without dragging: draw default direction arrow pointing forward/up
        drawDirectionArrow(ctx, s.x, s.y + 35, s.x, s.y, pen.color);
      } else {
        drawDirectionArrow(ctx, s.x, s.y, currentPos.x, currentPos.y, pen.color);
      }
    } else if (pen.mode === "screen") {
      if (snapshot.current) ctx.putImageData(snapshot.current, 0, 0);
      if (dist < 6) {
        // Clicked without dragging: draw default screen bar
        drawScreen(ctx, s.x, s.y + 25, s.x, s.y, pen.color);
      } else {
        drawScreen(ctx, s.x, s.y, currentPos.x, currentPos.y, pen.color);
      }
    } else if (pen.mode === "stamp") {
      if (snapshot.current) ctx.putImageData(snapshot.current, 0, 0);
      if (pen.stamp === "handoff") {
        drawHandoffHash(ctx, currentPos.x, currentPos.y);
      } else if (pen.stamp === "cone") {
        drawCone(ctx, currentPos.x, currentPos.y, pen.color);
      }
    }

    startPoint.current = null;
    snapshot.current = null;
    onChange(canvas.toDataURL("image/png"));
  }

  function restore(dataUrl: string | null) {
    const ctx = ctx2d();
    const canvas = canvasRef.current;
    if (!ctx || !canvas) return;
    drawCourt(ctx, sport);
    if (!dataUrl) {
      onChange(null);
      return;
    }
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, W, H);
      onChange(canvas.toDataURL("image/png"));
    };
    img.src = dataUrl;
  }

  function undo() {
    const prev = history.current.pop();
    restore(prev ?? null);
  }

  function clear() {
    history.current = [];
    restore(null);
  }

  return (
    <div className="rounded-md bg-ink-850 p-2 ring-1 ring-ink-700">
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {PENS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => setPen(p)}
            className={`flex items-center gap-1.5 rounded px-2 py-1 font-mono text-[10px] uppercase tracking-widest ring-1 transition-all ${
              pen.key === p.key
                ? "bg-ink-900 text-ink-100 ring-court-500 shadow-sm"
                : "text-ink-300 ring-ink-700 hover:text-ink-100"
            }`}
          >
            <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
            {p.label}
          </button>
        ))}
        <span className="ml-auto flex gap-1.5">
          <button
            type="button"
            onClick={undo}
            className="rounded px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-ink-300 ring-1 ring-ink-700 hover:bg-ink-800"
          >
            Undo
          </button>
          <button
            type="button"
            onClick={clear}
            className="rounded px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-bad ring-1 ring-ink-700 hover:bg-bad/10"
          >
            Clear
          </button>
        </span>
      </div>
      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        className="w-full touch-none rounded bg-[#0b1220] cursor-crosshair shadow-inner"
        style={{ aspectRatio: `${W} / ${H}` }}
      />
      <div className="mt-1.5 flex items-center justify-between font-mono text-[10px] text-ink-400">
        <span>
          {pen.mode === "direction" || pen.mode === "screen"
            ? "Click and drag anywhere to control length & turn in any 360° direction"
            : pen.stamp === "handoff"
              ? "Click or drag to place handoff '#' symbol"
              : "Draw or place elements with mouse or touch — saves automatically"}
        </span>
        <span className="text-court-400">Tactical Canvas ({sport})</span>
      </div>
    </div>
  );
}
