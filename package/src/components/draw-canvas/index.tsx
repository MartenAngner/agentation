"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import styles from "./styles.module.scss";
import { originalSetTimeout } from "../../utils/freeze-animations";
import { IconPen, IconArrowUpRight, IconSquare, IconUndo } from "../icons";

// =============================================================================
// Types
// =============================================================================

export type DrawStroke = {
  type: "free" | "arrow" | "rect";
  color: string;
  size: number;
  /** Freehand points as [[x, y], ...] — coordinates relative to canvas */
  points?: number[][];
  /** Arrow start [x, y] */
  from?: number[];
  /** Arrow end [x, y] */
  to?: number[];
  /** Rectangle bounds */
  x?: number;
  y?: number;
  w?: number;
  h?: number;
};

export interface DrawCanvasProps {
  /** Bounding box to scope the canvas to (fixed viewport coordinates) */
  boundingBox: { x: number; y: number; width: number; height: number };
  /** Accent color for UI elements */
  accentColor?: string;
  /** Existing strokes to render (for edit mode) */
  initialStrokes?: DrawStroke[];
  /** Called when drawing is done — returns strokes and base64 PNG image */
  onDone: (strokes: DrawStroke[], imageDataUrl: string | null) => void;
  /** Called when drawing is cancelled */
  onCancel: () => void;
  /** Called whenever strokes change — lets parent track current state */
  onStrokesChange?: (strokes: DrawStroke[]) => void;
  /** Light mode */
  lightMode?: boolean;
}

// =============================================================================
// Constants
// =============================================================================

const PADDING = 8;
const DEFAULT_COLOR = "#ff3333";
const DEFAULT_SIZE = 2;
const ARROW_HEAD_LEN = 10;
const ARROW_HEAD_ANGLE = 0.4;

// =============================================================================
// Component
// =============================================================================

export function DrawCanvas({
  boundingBox,
  accentColor = "#3c82f7",
  initialStrokes = [],
  onDone,
  onCancel,
  onStrokesChange,
  lightMode = false,
}: DrawCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const color = DEFAULT_COLOR;
  const brushSize = DEFAULT_SIZE;
  const [mode, setMode] = useState<"free" | "arrow" | "rect">("free");
  const [strokes, setStrokes] = useState<DrawStroke[]>(initialStrokes);

  // Drawing state refs (avoid re-renders during draw)
  const drawingRef = useRef(false);
  const startRef = useRef({ x: 0, y: 0 });
  const currentStrokeRef = useRef<DrawStroke | null>(null);
  const snapshotRef = useRef<ImageData | null>(null);

  // Canvas dimensions with padding
  const canvasX = boundingBox.x - PADDING;
  const canvasY = boundingBox.y - PADDING;
  const canvasW = boundingBox.width + PADDING * 2;
  const canvasH = boundingBox.height + PADDING * 2;

  // ---------------------------------------------------------------------------
  // Canvas setup + redraw
  // ---------------------------------------------------------------------------

  const getCtx = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    return canvas.getContext("2d");
  }, []);

  const initCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvasW * dpr;
    canvas.height = canvasH * dpr;
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.scale(dpr, dpr);
  }, [canvasW, canvasH]);

  /** Replay all strokes onto canvas */
  const redraw = useCallback(() => {
    const ctx = getCtx();
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, canvasW * dpr, canvasH * dpr);

    for (const stroke of strokes) {
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.size;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      if (stroke.type === "free" && stroke.points && stroke.points.length > 1) {
        ctx.beginPath();
        ctx.moveTo(stroke.points[0][0], stroke.points[0][1]);
        for (let i = 1; i < stroke.points.length; i++) {
          ctx.lineTo(stroke.points[i][0], stroke.points[i][1]);
        }
        ctx.stroke();
      } else if (stroke.type === "arrow" && stroke.from && stroke.to) {
        drawArrow(ctx, stroke.from, stroke.to, stroke.size);
      } else if (stroke.type === "rect" && stroke.x != null && stroke.y != null && stroke.w != null && stroke.h != null) {
        ctx.beginPath();
        ctx.strokeRect(stroke.x, stroke.y, stroke.w, stroke.h);
      }
    }
  }, [strokes, getCtx, canvasW, canvasH]);

  useEffect(() => {
    initCanvas();
    // Small delay to let canvas mount
    originalSetTimeout(redraw, 10);
  }, [initCanvas, redraw]);

  // Notify parent of stroke changes
  useEffect(() => {
    onStrokesChange?.(strokes);
  }, [strokes, onStrokesChange]);

  // ---------------------------------------------------------------------------
  // Drawing helpers
  // ---------------------------------------------------------------------------

  function drawArrow(ctx: CanvasRenderingContext2D, from: number[], to: number[], size: number) {
    ctx.beginPath();
    ctx.moveTo(from[0], from[1]);
    ctx.lineTo(to[0], to[1]);
    ctx.stroke();

    const angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
    ctx.beginPath();
    ctx.moveTo(to[0], to[1]);
    ctx.lineTo(
      to[0] - ARROW_HEAD_LEN * Math.cos(angle - ARROW_HEAD_ANGLE),
      to[1] - ARROW_HEAD_LEN * Math.sin(angle - ARROW_HEAD_ANGLE)
    );
    ctx.moveTo(to[0], to[1]);
    ctx.lineTo(
      to[0] - ARROW_HEAD_LEN * Math.cos(angle + ARROW_HEAD_ANGLE),
      to[1] - ARROW_HEAD_LEN * Math.sin(angle + ARROW_HEAD_ANGLE)
    );
    ctx.stroke();
  }

  function getPos(e: React.MouseEvent): { x: number; y: number } {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  // ---------------------------------------------------------------------------
  // Mouse handlers
  // ---------------------------------------------------------------------------

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      const pos = getPos(e);
      drawingRef.current = true;
      startRef.current = pos;

      const ctx = getCtx();
      if (!ctx) return;

      if (mode === "free") {
        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y);
        currentStrokeRef.current = {
          type: "free",
          color,
          size: brushSize,
          points: [[pos.x, pos.y]],
        };
      } else {
        snapshotRef.current = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
        currentStrokeRef.current = { type: mode, color, size: brushSize };
      }
    },
    [mode, color, brushSize, getCtx]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!drawingRef.current) return;
      const pos = getPos(e);
      const ctx = getCtx();
      if (!ctx) return;

      ctx.strokeStyle = color;
      ctx.lineWidth = brushSize;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      if (mode === "free") {
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
        if (currentStrokeRef.current?.points) {
          currentStrokeRef.current.points.push([pos.x, pos.y]);
        }
      } else if (snapshotRef.current) {
        ctx.putImageData(snapshotRef.current, 0, 0);
        if (mode === "rect") {
          ctx.beginPath();
          ctx.strokeRect(
            startRef.current.x,
            startRef.current.y,
            pos.x - startRef.current.x,
            pos.y - startRef.current.y
          );
        } else if (mode === "arrow") {
          drawArrow(ctx, [startRef.current.x, startRef.current.y], [pos.x, pos.y], brushSize);
        }
      }
    },
    [mode, color, brushSize, getCtx]
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent) => {
      if (!drawingRef.current) return;
      drawingRef.current = false;
      snapshotRef.current = null;

      const pos = getPos(e);
      const stroke = currentStrokeRef.current;
      if (!stroke) return;

      if (stroke.type === "arrow") {
        stroke.from = [startRef.current.x, startRef.current.y];
        stroke.to = [pos.x, pos.y];
      } else if (stroke.type === "rect") {
        stroke.x = Math.min(startRef.current.x, pos.x);
        stroke.y = Math.min(startRef.current.y, pos.y);
        stroke.w = Math.abs(pos.x - startRef.current.x);
        stroke.h = Math.abs(pos.y - startRef.current.y);
      } else if (stroke.type === "free" && stroke.points) {
        // Simplify freehand points to reduce data size
        stroke.points = stroke.points.filter(
          (_, i, arr) => i % 3 === 0 || i === arr.length - 1
        ).map((p) => [Math.round(p[0]), Math.round(p[1])]);
      }

      currentStrokeRef.current = null;
      setStrokes((prev) => [...prev, stroke]);
    },
    []
  );

  const handleMouseLeave = useCallback(() => {
    drawingRef.current = false;
    snapshotRef.current = null;
    currentStrokeRef.current = null;
  }, []);

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  const handleUndo = useCallback(() => {
    setStrokes((prev) => {
      if (prev.length === 0) return prev;
      return prev.slice(0, -1);
    });
  }, []);

  const handleClear = useCallback(() => {
    setStrokes([]);
    const ctx = getCtx();
    if (ctx) ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }, [getCtx]);

  const handleDone = useCallback(() => {
    const canvas = canvasRef.current;
    const imageDataUrl = canvas && strokes.length > 0 ? canvas.toDataURL("image/png") : null;
    onDone(strokes, imageDataUrl);
  }, [strokes, onDone]);

  // Escape to cancel
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCancel();
      }
    };
    document.addEventListener("keydown", handleKey, true);
    return () => document.removeEventListener("keydown", handleKey, true);
  }, [onCancel]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <>
      {/* Canvas positioned over the element */}
      <canvas
        ref={canvasRef}
        className={styles.canvas}
        data-feedback-toolbar
        style={{
          left: canvasX,
          top: canvasY,
          width: canvasW,
          height: canvasH,
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
      />

      {/* Toolbar positioned above the canvas */}
      <div
        className={styles.toolbar}
        data-feedback-toolbar
        style={{
          left: canvasX + canvasW / 2,
          top: Math.max(canvasY - 48, 8),
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className={styles.controlButton}
          data-active={mode === "free"}
          onClick={() => setMode("free")}
          title="Freehand"
          type="button"
        >
          <IconPen size={24} />
        </button>
        <button
          className={styles.controlButton}
          data-active={mode === "arrow"}
          onClick={() => setMode("arrow")}
          title="Arrow"
          type="button"
        >
          <IconArrowUpRight size={24} />
        </button>
        <button
          className={styles.controlButton}
          data-active={mode === "rect"}
          onClick={() => setMode("rect")}
          title="Rectangle"
          type="button"
        >
          <IconSquare size={24} />
        </button>
        <span className={styles.divider} />
        <button
          className={styles.controlButton}
          onClick={handleUndo}
          title="Undo"
          type="button"
          disabled={strokes.length === 0}
        >
          <IconUndo size={24} />
        </button>
      </div>
    </>
  );
}

export default DrawCanvas;
