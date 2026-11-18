import {
  AdditiveBlending,
  CanvasTexture,
  Group,
  Mesh,
  MeshBasicMaterial,
  Path,
  PlaneGeometry,
  Shape,
  ShapeGeometry,
  SRGBColorSpace,
  Vector2,
} from '@iwsdk/core';

/**
 * Tiny 2D toolkit for shadow-puppet silhouettes. Everything is a flat
 * ShapeGeometry in a Group's XY plane (the wall), coloured like a shadow.
 */

/** Same near-black as a real hand shadow on the lit wall. */
export const SHADOW_COLOR = 0x070302;

export function shadowMaterial(): MeshBasicMaterial {
  return new MeshBasicMaterial({ color: SHADOW_COLOR, transparent: true, opacity: 1, depthWrite: false });
}

export function ellipse(cx: number, cy: number, rx: number, ry: number, rot = 0): Shape {
  const s = new Shape();
  s.absellipse(cx, cy, rx, ry, 0, Math.PI * 2, false, rot);
  return s;
}

export function circle(cx: number, cy: number, r: number): Shape {
  return ellipse(cx, cy, r, r);
}

/** Polygon from a flat [x0, y0, x1, y1, ...] list. */
export function poly(pts: number[]): Shape {
  const v: Vector2[] = [];
  for (let i = 0; i < pts.length; i += 2) v.push(new Vector2(pts[i], pts[i + 1]));
  return new Shape(v);
}

/** Rounded bar from A to B, `w` wide — limbs, ears, tails. */
export function capsule(ax: number, ay: number, bx: number, by: number, w: number): Shape {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  const c = dx / (len || 1);
  const s = dy / (len || 1);
  const r = w / 2;
  const pts: Vector2[] = [];
  const add = (x: number, y: number) => pts.push(new Vector2(ax + x * c - y * s, ay + x * s + y * c));
  for (let i = 0; i <= 8; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / 8;
    add(Math.cos(a) * r, Math.sin(a) * r);
  }
  for (let i = 0; i <= 8; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 8;
    add(len + Math.cos(a) * r, Math.sin(a) * r);
  }
  return new Shape(pts);
}

/** Punch an elliptical hole (an eye) into a shape. */
export function withHole(shape: Shape, cx: number, cy: number, rx: number, ry = rx): Shape {
  const p = new Path();
  p.absellipse(cx, cy, rx, ry, 0, Math.PI * 2, true);
  shape.holes.push(p);
  return shape;
}

/** One mesh from several shapes sharing a material. */
export function part(shapes: Shape[], mat: MeshBasicMaterial): Mesh {
  const m = new Mesh(new ShapeGeometry(shapes, 8), mat);
  m.renderOrder = 3;
  return m;
}

/** A Group positioned at a pivot, so children rotate about that point. */
export function pivot(x: number, y: number, ...children: Mesh[]): Group {
  const g = new Group();
  g.position.set(x, y, 0);
  g.add(...children);
  return g;
}

let glowTex: CanvasTexture | undefined;
/** Warm additive glow disc — the only colour allowed in the shadow world. */
export function glow(size: number, opacity = 0.9): Mesh {
  if (!glowTex) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,240,200,1)');
    g.addColorStop(0.2, 'rgba(255,190,90,0.8)');
    g.addColorStop(0.55, 'rgba(255,130,40,0.25)');
    g.addColorStop(1, 'rgba(255,110,30,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    glowTex = new CanvasTexture(c);
    glowTex.colorSpace = SRGBColorSpace;
  }
  const m = new Mesh(
    new PlaneGeometry(size, size),
    new MeshBasicMaterial({ map: glowTex, transparent: true, opacity, blending: AdditiveBlending, depthWrite: false }),
  );
  m.renderOrder = 4;
  return m;
}

let whiteGlowTex: CanvasTexture | undefined;
/** Tintable glow disc (purple magic, seals, the Shadow Eater's eyes). */
export function magicGlow(size: number, color: number, opacity = 0.9): Mesh {
  if (!whiteGlowTex) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.65)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.18)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    whiteGlowTex = new CanvasTexture(c);
    whiteGlowTex.colorSpace = SRGBColorSpace;
  }
  const m = new Mesh(
    new PlaneGeometry(size, size),
    new MeshBasicMaterial({ map: whiteGlowTex, color, transparent: true, opacity, blending: AdditiveBlending, depthWrite: false }),
  );
  m.renderOrder = 4;
  return m;
}

/** Faint silhouette material for distant scenery behind the stage. */
export function backdropMaterial(opacity = 0.42): MeshBasicMaterial {
  return new MeshBasicMaterial({ color: SHADOW_COLOR, transparent: true, opacity, depthWrite: false });
}

// ---------------------------------------------------------------------------
// Easing + tiny coroutine scripting for level cutscenes
// ---------------------------------------------------------------------------

export const ease = {
  inOut: (k: number) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2),
  out: (k: number) => 1 - Math.pow(1 - k, 3),
  in: (k: number) => k * k * k,
  backOut: (k: number) => 1 + 2.70158 * Math.pow(k - 1, 3) + 1.70158 * Math.pow(k - 1, 2),
};

/** A cutscene step. Each `yield` hands back the frame's dt. */
export type Script = Generator<void, void, number>;

export function* wait(seconds: number): Script {
  let t = 0;
  while (t < seconds) t += yield;
}

/** Calls fn(k) with k going 0 → 1 over `seconds`. */
export function* tween(seconds: number, fn: (k: number) => void): Script {
  let t = 0;
  fn(0);
  while (t < seconds) {
    t += yield;
    fn(Math.min(1, t / seconds));
  }
}

/** Runs one cutscene script at a time, advanced once per frame. */
export class ScriptRunner {
  private current: Script | undefined;

  get running(): boolean {
    return this.current !== undefined;
  }

  start(script: Script): void {
    this.current = script;
    this.current.next(0); // run to the first yield
  }

  stop(): void {
    this.current = undefined;
  }

  update(dt: number): void {
    if (!this.current) return;
    if (this.current.next(dt).done) this.current = undefined;
  }
}
