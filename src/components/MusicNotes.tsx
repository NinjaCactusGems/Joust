import { useEffect, useRef } from 'react';

/**
 * Subtle background canvas of music-note glyphs drifting left -> right.
 * Notes dodge the pointer / touch location (repulsion), then ease back to
 * their baseline drift. Purely decorative: fixed, behind content, and
 * `pointer-events: none` so it never blocks the UI. Respects reduced motion.
 */

const GLYPHS = ['♪', '♫', '♩', '♬']; // ♪ ♫ ♩ ♬

const MIN_SIZE = 14;
const MAX_SIZE = 34;
const MIN_OPACITY = 0.1;
const MAX_OPACITY = 0.24;
const MIN_VX = 0.15;
const MAX_VX = 0.5;

const REPEL_RADIUS = 110;
const REPEL_FORCE = 0.9;
const EASE_BACK = 0.04;

const MAX_COUNT = 52;
const MIN_COUNT = 16;
const POINTER_IDLE_MS = 1200; // notes resettle if pointer stops moving

const INK_FALLBACK = '#1F1B16';

type Note = {
  x: number;
  y: number;
  size: number;
  glyph: string;
  baseVx: number;
  vx: number;
  vy: number;
  opacity: number;
};

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function targetCount(width: number): number {
  return Math.max(MIN_COUNT, Math.min(MAX_COUNT, Math.round(Math.min(width, 900) / 15)));
}

/** A note's horizontal speed scales with its size for a gentle parallax feel. */
function makeNote(width: number, height: number, atLeftEdge: boolean): Note {
  const size = rand(MIN_SIZE, MAX_SIZE);
  const sizeFrac = (size - MIN_SIZE) / (MAX_SIZE - MIN_SIZE);
  const baseVx = MIN_VX + sizeFrac * (MAX_VX - MIN_VX);
  return {
    x: atLeftEdge ? -size - rand(0, width * 0.3) : rand(-size, width),
    y: rand(0, height),
    size,
    glyph: GLYPHS[Math.floor(Math.random() * GLYPHS.length)],
    baseVx,
    vx: baseVx,
    vy: 0,
    opacity: rand(MIN_OPACITY, MAX_OPACITY),
  };
}

export function MusicNotes() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const ink =
      getComputedStyle(document.documentElement)
        .getPropertyValue('--color-ink')
        .trim() || INK_FALLBACK;

    let width = window.innerWidth;
    let height = window.innerHeight;
    let notes: Note[] = [];
    let rafId = 0;
    let running = false;

    const pointer = { x: 0, y: 0, active: false };
    let pointerTimer = 0;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    function resize() {
      width = window.innerWidth;
      height = window.innerHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas!.width = Math.floor(width * dpr);
      canvas!.height = Math.floor(height * dpr);
      canvas!.style.width = `${width}px`;
      canvas!.style.height = `${height}px`;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Match particle count to viewport.
      const want = targetCount(width);
      while (notes.length < want) notes.push(makeNote(width, height, true));
      if (notes.length > want) notes.length = want;
    }

    function draw() {
      ctx!.clearRect(0, 0, width, height);
      ctx!.fillStyle = ink;
      ctx!.textAlign = 'center';
      ctx!.textBaseline = 'middle';
      for (const n of notes) {
        ctx!.globalAlpha = n.opacity;
        ctx!.font = `${n.size}px serif`;
        ctx!.fillText(n.glyph, n.x, n.y);
      }
      ctx!.globalAlpha = 1;
    }

    function step() {
      for (const n of notes) {
        // Repulsion away from the pointer, with a soft falloff to the edge.
        if (pointer.active) {
          const dx = n.x - pointer.x;
          const dy = n.y - pointer.y;
          const dist = Math.hypot(dx, dy);
          if (dist < REPEL_RADIUS) {
            const falloff = (1 - dist / REPEL_RADIUS) ** 2;
            if (dist > 0.0001) {
              n.vx += (dx / dist) * REPEL_FORCE * falloff;
              n.vy += (dy / dist) * REPEL_FORCE * falloff;
            } else {
              n.vx += rand(-1, 1) * REPEL_FORCE;
              n.vy += rand(-1, 1) * REPEL_FORCE;
            }
          }
        }

        // Ease back toward the baseline rightward drift.
        n.vx += (n.baseVx - n.vx) * EASE_BACK;
        n.vy += (0 - n.vy) * EASE_BACK;

        n.x += n.vx;
        n.y += n.vy;

        // Recycle off the right edge; wrap if pushed past top/bottom.
        if (n.x - n.size > width) {
          Object.assign(n, makeNote(width, height, true), { x: -n.size });
        }
        if (n.y < -n.size) n.y = height + n.size;
        else if (n.y > height + n.size) n.y = -n.size;
      }

      draw();
      rafId = requestAnimationFrame(step);
    }

    function start() {
      if (running) return;
      running = true;
      rafId = requestAnimationFrame(step);
    }

    function stop() {
      running = false;
      cancelAnimationFrame(rafId);
    }

    function onPointerMove(e: PointerEvent) {
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      pointer.active = true;
      window.clearTimeout(pointerTimer);
      pointerTimer = window.setTimeout(() => {
        pointer.active = false;
      }, POINTER_IDLE_MS);
    }

    function clearPointer() {
      pointer.active = false;
      window.clearTimeout(pointerTimer);
    }

    function onVisibility() {
      if (document.hidden) stop();
      else if (!reduceMotion.matches) start();
    }

    function onMotionPrefChange() {
      stop();
      if (reduceMotion.matches) {
        draw(); // single static frame
      } else {
        start();
      }
    }

    // Init
    resize();
    notes = Array.from({ length: targetCount(width) }, () =>
      makeNote(width, height, false),
    );

    window.addEventListener('resize', resize);
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerdown', onPointerMove, { passive: true });
    window.addEventListener('pointercancel', clearPointer);
    window.addEventListener('blur', clearPointer);
    document.addEventListener('visibilitychange', onVisibility);
    reduceMotion.addEventListener('change', onMotionPrefChange);

    if (reduceMotion.matches) {
      draw(); // static frame, no animation loop
    } else {
      start();
    }

    return () => {
      stop();
      window.clearTimeout(pointerTimer);
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerdown', onPointerMove);
      window.removeEventListener('pointercancel', clearPointer);
      window.removeEventListener('blur', clearPointer);
      document.removeEventListener('visibilitychange', onVisibility);
      reduceMotion.removeEventListener('change', onMotionPrefChange);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="fixed inset-0 z-0 pointer-events-none"
    />
  );
}
