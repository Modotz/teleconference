'use client';

import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { X, Pencil, Eraser, Trash2 } from 'lucide-react';

export interface Stroke {
  id: string;
  color: string;
  size: number;
  erase: boolean;
  points: { x: number; y: number }[]; // normalized 0..1
}

interface Props {
  open: boolean;
  onClose: () => void;
  strokesRef: MutableRefObject<Stroke[]>;
  dirtyRef: MutableRefObject<boolean>;
  onSegment: (seg: {
    id: string;
    color: string;
    size: number;
    erase: boolean;
    points: { x: number; y: number }[];
  }) => void;
  onClear: () => void;
}

const COLORS = ['#111827', '#ef4444', '#3b82f6', '#22c55e', '#f59e0b'];
const PEN_SIZES = [2, 4, 8];

export default function Whiteboard({
  open,
  onClose,
  strokesRef,
  dirtyRef,
  onSegment,
  onClear,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [color, setColor] = useState(COLORS[0]);
  const [size, setSize] = useState(4);
  const [tool, setTool] = useState<'pen' | 'eraser'>('pen');

  const drawing = useRef(false);
  const currentId = useRef<string | null>(null);
  const buffer = useRef<{ x: number; y: number }[]>([]);
  const lastSend = useRef(0);

  // Render loop: redraw the whole board whenever something changed.
  useEffect(() => {
    if (!open) return;
    let raf = 0;

    function fit() {
      const c = canvasRef.current;
      if (!c) return;
      const r = c.getBoundingClientRect();
      if (c.width !== Math.round(r.width) || c.height !== Math.round(r.height)) {
        c.width = Math.round(r.width);
        c.height = Math.round(r.height);
        dirtyRef.current = true;
      }
    }

    function redraw() {
      const c = canvasRef.current;
      if (!c) return;
      const ctx = c.getContext('2d');
      if (!ctx) return;
      const w = c.width;
      const h = c.height;
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const s of strokesRef.current) {
        if (!s.points.length) continue;
        ctx.globalCompositeOperation = s.erase ? 'destination-out' : 'source-over';
        ctx.strokeStyle = s.color;
        ctx.lineWidth = Math.max(1, s.size * (w / 1000));
        ctx.beginPath();
        ctx.moveTo(s.points[0].x * w, s.points[0].y * h);
        for (let i = 1; i < s.points.length; i++) {
          ctx.lineTo(s.points[i].x * w, s.points[i].y * h);
        }
        ctx.stroke();
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    function loop() {
      raf = requestAnimationFrame(loop);
      fit();
      if (dirtyRef.current) {
        dirtyRef.current = false;
        redraw();
      }
    }
    dirtyRef.current = true;
    loop();
    const onResize = () => (dirtyRef.current = true);
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
    };
  }, [open, strokesRef, dirtyRef]);

  function norm(e: React.PointerEvent) {
    const r = canvasRef.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  }

  function flush() {
    if (!currentId.current || !buffer.current.length) return;
    onSegment({
      id: currentId.current,
      color,
      size: tool === 'eraser' ? 24 : size,
      erase: tool === 'eraser',
      points: buffer.current,
    });
    buffer.current = [];
  }

  function down(e: React.PointerEvent) {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drawing.current = true;
    const id = Math.random().toString(36).slice(2);
    currentId.current = id;
    const p = norm(e);
    strokesRef.current.push({
      id,
      color,
      size: tool === 'eraser' ? 24 : size,
      erase: tool === 'eraser',
      points: [p],
    });
    buffer.current = [p];
    dirtyRef.current = true;
    lastSend.current = 0;
  }
  function move(e: React.PointerEvent) {
    if (!drawing.current || !currentId.current) return;
    const p = norm(e);
    const stroke = strokesRef.current.find((s) => s.id === currentId.current);
    stroke?.points.push(p);
    buffer.current.push(p);
    dirtyRef.current = true;
    const now = performance.now();
    if (now - lastSend.current > 50) {
      lastSend.current = now;
      flush();
    }
  }
  function up() {
    if (!drawing.current) return;
    drawing.current = false;
    flush();
    currentId.current = null;
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-950">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 bg-slate-900 border-b border-slate-800">
        <span className="font-medium text-sm mr-2">Whiteboard</span>
        <button
          onClick={() => setTool('pen')}
          title="Pen"
          className={`p-2 rounded ${
            tool === 'pen' ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-300'
          }`}
        >
          <Pencil className="w-4 h-4" />
        </button>
        <button
          onClick={() => setTool('eraser')}
          title="Eraser"
          className={`p-2 rounded ${
            tool === 'eraser' ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-300'
          }`}
        >
          <Eraser className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-1 ml-1">
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => {
                setColor(c);
                setTool('pen');
              }}
              className={`w-6 h-6 rounded-full border-2 ${
                color === c && tool === 'pen'
                  ? 'border-white'
                  : 'border-transparent'
              }`}
              style={{ backgroundColor: c }}
              aria-label={`Color ${c}`}
            />
          ))}
        </div>

        <div className="flex items-center gap-1 ml-1">
          {PEN_SIZES.map((s) => (
            <button
              key={s}
              onClick={() => {
                setSize(s);
                setTool('pen');
              }}
              className={`w-7 h-7 rounded flex items-center justify-center ${
                size === s && tool === 'pen' ? 'bg-slate-700' : 'bg-slate-800'
              }`}
              aria-label={`Size ${s}`}
            >
              <span
                className="rounded-full bg-slate-100 block"
                style={{ width: s + 2, height: s + 2 }}
              />
            </button>
          ))}
        </div>

        <button
          onClick={onClear}
          title="Clear board"
          className="ml-auto p-2 rounded bg-slate-800 hover:bg-red-600/40 text-slate-300"
        >
          <Trash2 className="w-4 h-4" />
        </button>
        <button
          onClick={onClose}
          title="Close"
          className="p-2 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Canvas */}
      <div className="flex-1 min-h-0 p-2">
        <canvas
          ref={canvasRef}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerLeave={up}
          className="w-full h-full rounded-lg bg-white touch-none cursor-crosshair"
        />
      </div>
    </div>
  );
}
