import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DoubleSide,
  Euler,
  Float32BufferAttribute,
  IcosahedronGeometry,
  InstancedMesh,
  LatheGeometry,
  type Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Quaternion,
  RepeatWrapping,
  Shape,
  SphereGeometry,
  SRGBColorSpace,
  Vector2,
  Vector3,
} from '@iwsdk/core';
import { EYE_Y, WALL_Z } from '../layout.js';

/**
 * Shared toolkit for the five worlds.
 *
 * Quest-friendly look: geometry is merged per material into a handful of
 * draw calls, and lighting is *baked* into vertex colours when a world is
 * built (warm candle pools, moonlight, soft floor occlusion), so the scenery
 * costs no dynamic lights at all. Textures are painted procedurally on canvas
 * (fBm noise, masonry, carvings), skies are painted equirectangular domes.
 */

// ---------------------------------------------------------------------------
// Random & noise

export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Tileable fBm value noise in [0, 1], `size`×`size`. */
export function noiseField(size: number, seed: number, octaves = 5, base = 4, gain = 0.5): Float32Array {
  const out = new Float32Array(size * size);
  const r = rng(seed);
  let amp = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const f = base << o;
    if (f > size) break;
    const grid = new Float32Array(f * f);
    for (let i = 0; i < grid.length; i++) grid[i] = r();
    const step = f / size;
    for (let y = 0; y < size; y++) {
      const gy = y * step;
      const y0 = Math.floor(gy);
      let ty = gy - y0;
      ty = ty * ty * (3 - 2 * ty);
      const r0 = (y0 % f) * f;
      const r1 = ((y0 + 1) % f) * f;
      for (let x = 0; x < size; x++) {
        const gx = x * step;
        const x0 = Math.floor(gx);
        let tx = gx - x0;
        tx = tx * tx * (3 - 2 * tx);
        const c0 = x0 % f;
        const c1 = (x0 + 1) % f;
        const a = grid[r0 + c0] + (grid[r0 + c1] - grid[r0 + c0]) * tx;
        const b = grid[r1 + c0] + (grid[r1 + c1] - grid[r1 + c0]) * tx;
        out[y * size + x] += (a + (b - a) * ty) * amp;
      }
    }
    total += amp;
    amp *= gain;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

/** Cheap smooth 3D noise for displacing geometry (not tileable; fine for rocks). */
export function noise3(x: number, y: number, z: number): number {
  return (
    Math.sin(x * 1.7 + Math.sin(z * 1.3)) * 0.5 +
    Math.sin(y * 2.3 + Math.sin(x * 0.9)) * 0.3 +
    Math.sin(z * 3.1 + y * 1.1 + Math.sin(x * 2.7)) * 0.2
  );
}

// ---------------------------------------------------------------------------
// Textures

export function canvas(w: number, h = w): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

export function toTex(c: HTMLCanvasElement, repeat = true): CanvasTexture {
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}

type RGB = [number, number, number];

export interface StoneOpts {
  size?: number;
  seed: number;
  base: RGB;
  /** Large-scale tone variation (0..1). */
  vary?: number;
  /** Masonry: block rows (0 = no blocks) and blocks per row. */
  rows?: number;
  cols?: number;
  mortar?: number;
  /** Second colour (moss, lichen, verdigris) creeping in where noise is high. */
  tint2?: RGB;
  tint2Amt?: number;
  /** Dark hairline cracks. */
  cracks?: number;
  /** Extra painting on top (carvings, lines). */
  paint?: (ctx: CanvasRenderingContext2D, size: number) => void;
}

/** Painted stone / plaster / bark: fBm tone, optional masonry blocks with bevelled edges. */
export function stoneTex(o: StoneOpts): CanvasTexture {
  const size = o.size ?? 512;
  const [c, ctx] = canvas(size);
  const big = noiseField(size, o.seed, 5, 4);
  const fine = noiseField(size, o.seed + 7, 3, 64);
  const r = rng(o.seed + 3);
  const rows = o.rows ?? 0;
  const vary = o.vary ?? 0.45;
  const rowH = rows ? size / rows : size;
  const mortar = o.mortar ?? 3;
  // Per row: block boundaries (wrapping) and per-block tone.
  const bounds: number[][] = [];
  const tones: number[][] = [];
  for (let y = 0; y < Math.max(1, rows); y++) {
    const cols = o.cols ?? 3;
    const b: number[] = [];
    let x = r() * (size / cols);
    const first = x;
    while (x < size + first - size / cols / 2) {
      b.push(x);
      x += (size / cols) * (0.7 + r() * 0.6);
    }
    bounds.push(b);
    tones.push(b.map(() => 0.82 + r() * 0.3));
  }
  const img = ctx.createImageData(size, size);
  const t2 = o.tint2;
  const t2a = o.tint2Amt ?? 0;
  for (let y = 0; y < size; y++) {
    const row = rows ? Math.floor(y / rowH) : 0;
    const inRow = y - row * rowH;
    const b = bounds[row];
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      let k = 1 - vary / 2 + vary * big[i];
      k *= 0.8 + 0.4 * fine[i];
      if (rows) {
        // Which block, and how far to its edges.
        let bi = b.length - 1;
        for (let j = 0; j < b.length; j++) if (x >= b[j]) bi = j;
        const x0 = b[bi];
        const x1 = bi + 1 < b.length ? b[bi + 1] : b[0] + size;
        let dx = x - x0;
        if (dx < 0) dx += size;
        const w = x1 - x0;
        const edge = Math.min(dx, w - dx, inRow, rowH - inRow);
        k *= tones[row][bi];
        if (edge < mortar) k *= 0.35 + 0.1 * fine[i];
        else if (edge < mortar + 4) {
          // Bevel: lit top/left edges, shadowed bottom/right.
          const lit = inRow < mortar + 4 || dx < mortar + 4;
          k *= lit ? 1.18 : 0.72;
        }
      }
      let cr = o.base[0] * k;
      let cg = o.base[1] * k;
      let cb = o.base[2] * k;
      if (t2 && t2a > 0) {
        const m = Math.max(0, Math.min(1, (big[(i + size * 37) % (size * size)] - (1 - t2a)) * 4));
        cr += (t2[0] * k - cr) * m;
        cg += (t2[1] * k - cg) * m;
        cb += (t2[2] * k - cb) * m;
      }
      img.data[i * 4] = cr;
      img.data[i * 4 + 1] = cg;
      img.data[i * 4 + 2] = cb;
      img.data[i * 4 + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  if (o.cracks) {
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 1.2;
    for (let k = 0; k < o.cracks; k++) {
      let x = r() * size;
      let y = r() * size;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let s = 0; s < 7; s++) {
        x += (r() - 0.5) * 40;
        y += (r() - 0.3) * 30;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }
  o.paint?.(ctx, size);
  return toTex(c);
}

/**
 * A whole-wall surface texture (7 m × 4.5 m): light enough for hand shadows to
 * read, with `paint` adding the world's character on top of fine grain.
 */
export function wallSurface(seed: number, base: RGB, grain: number, paint?: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): CanvasTexture {
  const w = 1024;
  const h = 660;
  const [c, ctx] = canvas(w, h);
  const big = noiseField(256, seed, 5, 3);
  const fine = noiseField(256, seed + 1, 3, 64);
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = ((y & 255) << 8) | (x & 255);
      const j = (((y >> 2) & 255) << 8) | ((x >> 2) & 255);
      const k = 1 - grain + grain * (0.6 * big[j] + 0.4 * fine[i]) * 1.6;
      const p = (y * w + x) * 4;
      img.data[p] = Math.min(255, base[0] * k);
      img.data[p + 1] = Math.min(255, base[1] * k);
      img.data[p + 2] = Math.min(255, base[2] * k);
      img.data[p + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  paint?.(ctx, w, h);
  const t = toTex(c, false);
  return t;
}

/** Soft round sprite. */
let softTex: CanvasTexture | undefined;
export function soft(): CanvasTexture {
  if (!softTex) {
    const [c, ctx] = canvas(64);
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    softTex = new CanvasTexture(c);
  }
  return softTex;
}

// ---------------------------------------------------------------------------
// Sky

/** A painted equirectangular sky (u = azimuth, v = elevation, top row = zenith). */
export function skyDome(paint: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, radius = 110, w = 2048): Mesh {
  const h = w / 2;
  const [c, ctx] = canvas(w, h);
  paint(ctx, w, h);
  const tex = toTex(c, false);
  tex.wrapS = RepeatWrapping;
  const m = new Mesh(new SphereGeometry(radius, 48, 24), new MeshBasicMaterial({ map: tex, side: BackSide, depthWrite: false, fog: false }));
  m.renderOrder = -10;
  m.position.y = EYE_Y;
  return m;
}

/** Sky painting helpers: elevation → canvas y. `el` in degrees (-90..90). */
export const elY = (el: number, h: number) => ((90 - el) / 180) * h;
/** Azimuth in degrees (0 = straight ahead toward the wall, 90 = right) → canvas x. */
export const azX = (az: number, w: number) => ((((az + 270) % 360) + 360) % 360) / 360 * w;

export function skyGradient(ctx: CanvasRenderingContext2D, w: number, h: number, stops: [number, string][]): void {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  for (const [el, col] of stops) g.addColorStop(Math.min(1, Math.max(0, (90 - el) / 180)), col);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

export function skyStars(ctx: CanvasRenderingContext2D, w: number, h: number, n: number, seed: number, minEl = 5, alpha = 1): void {
  const r = rng(seed);
  for (let k = 0; k < n; k++) {
    const el = minEl + Math.asin(r()) * (180 / Math.PI) * ((90 - minEl) / 90);
    const x = r() * w;
    const y = elY(el, h);
    const b = r();
    const s = b > 0.97 ? 2.2 : b > 0.85 ? 1.4 : 0.8;
    ctx.fillStyle = `rgba(${220 + r() * 35},${225 + r() * 30},255,${(0.35 + b * 0.65) * alpha})`;
    // Stretch horizontally toward the zenith so stars stay round on the sphere.
    const stretch = 1 / Math.max(0.15, Math.cos((el * Math.PI) / 180));
    ctx.fillRect(x, y, s * Math.min(stretch, 6), s);
  }
}

/** Soft coloured clouds of light (nebulae, glows, haze) in sky space. */
export function skyBlob(ctx: CanvasRenderingContext2D, w: number, h: number, az: number, el: number, rx: number, ry: number, color: string, alpha: number): void {
  const x = azX(az, w);
  const y = elY(el, h);
  const sx = (rx / 360) * w;
  const sy = (ry / 180) * h;
  for (const dx of [0, -w, w]) {
    ctx.save();
    ctx.translate(x + dx, y);
    ctx.scale(sx / 100, sy / 100);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 100);
    g.addColorStop(0, color.replace('A', String(alpha)));
    g.addColorStop(1, color.replace('A', '0'));
    ctx.fillStyle = g;
    ctx.fillRect(-100, -100, 200, 200);
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// Geometry batching with baked lighting

export interface BakeLight {
  p: Vector3;
  color: number;
  /** Intensity at the light. */
  k: number;
  /** Range (m). */
  r: number;
}
export interface Bake {
  sky: number;
  ground: number;
  amb: number;
  /** Directional key light: direction *toward* the light. */
  sun?: { dir: Vector3; color: number; k: number };
  lights: BakeLight[];
  /** Darken near the floor (contact occlusion), 0..1. */
  ao?: number;
  aoHeight?: number;
  /** Fade to black with height (dark ceilings), metres where it starts. */
  topDark?: number;
}

const _c = new Color();
const _sky = new Color();
const _gnd = new Color();
const _lc = new Color();
const _v = new Vector3();
const _n = new Vector3();
const _l = new Vector3();

/** Bake lighting into a geometry's `color` attribute (multiplying any existing tint). */
export function bakeGeometry(geo: BufferGeometry, env: Bake): void {
  const pos = geo.attributes.position;
  if (!geo.attributes.normal) geo.computeVertexNormals();
  const nor = geo.attributes.normal;
  let col = geo.attributes.color as BufferAttribute | undefined;
  if (!col) {
    col = new Float32BufferAttribute(new Float32Array(pos.count * 3).fill(1), 3);
    geo.setAttribute('color', col);
  }
  _sky.set(env.sky);
  _gnd.set(env.ground);
  const sunC = env.sun ? new Color(env.sun.color) : null;
  const lights = env.lights.map((l) => ({ ...l, c: new Color(l.color) }));
  const aoH = env.aoHeight ?? 1.2;
  for (let i = 0; i < pos.count; i++) {
    _v.fromBufferAttribute(pos, i);
    _n.fromBufferAttribute(nor, i);
    const hemi = _n.y * 0.5 + 0.5;
    _c.copy(_gnd).lerp(_sky, hemi).multiplyScalar(env.amb);
    if (env.sun && sunC) {
      const d = Math.max(0, (_n.dot(env.sun.dir) + 0.25) / 1.25);
      _c.r += sunC.r * env.sun.k * d;
      _c.g += sunC.g * env.sun.k * d;
      _c.b += sunC.b * env.sun.k * d;
    }
    for (const l of lights) {
      _l.subVectors(l.p, _v);
      const dist = _l.length();
      if (dist > l.r) continue;
      _l.divideScalar(dist || 1);
      const ndl = Math.max(0, (_n.dot(_l) + 0.35) / 1.35);
      const fall = 1 - dist / l.r;
      const a = l.k * ndl * fall * fall;
      _lc.copy(l.c);
      _c.r += _lc.r * a;
      _c.g += _lc.g * a;
      _c.b += _lc.b * a;
    }
    let k = 1;
    if (env.ao) {
      const t = Math.min(1, Math.max(0, _v.y / aoH));
      k *= 1 - env.ao * (1 - t * t * (3 - 2 * t));
    }
    if (env.topDark !== undefined && _v.y > env.topDark) k *= Math.max(0.25, 1 - (_v.y - env.topDark) * 0.12);
    col.setXYZ(i, col.getX(i) * _c.r * k, col.getY(i) * _c.g * k, col.getZ(i) * _c.b * k);
  }
  col.needsUpdate = true;
}

const _m = new Matrix4();
const BOX = new BoxGeometry(1, 1, 1);
const _q = new Quaternion();
const _e = new Euler();
const _p = new Vector3();
const _s = new Vector3();

/**
 * Collects many transformed copies of geometries that share one material and
 * merges them into a single mesh (one draw call), with optional per-part tint
 * and baked lighting.
 */
export class Batch {
  private readonly parts: BufferGeometry[] = [];
  constructor(readonly material: Material) {}

  get size(): number {
    return this.parts.length;
  }

  /** Add `geo` placed at (x,y,z), Euler rotation (rx,ry,rz), scale, tinted; `uv` scales texture coordinates. */
  add(geo: BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx, tint = 0xffffff, uv?: [number, number]): this {
    _q.setFromEuler(_e.set(rx, ry, rz, 'YXZ'));
    _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
    return this.addMatrix(geo, _m, tint, uv);
  }

  /** A box of size (w,h,d) with texture repeated per metre (`texel` metres per texture tile). */
  box(x: number, y: number, z: number, w: number, h: number, d: number, tint = 0xffffff, texel = 2, ry = 0): this {
    _q.setFromEuler(_e.set(0, ry, 0));
    _m.compose(_p.set(x, y, z), _q, _s.set(w, h, d));
    const g = BOX.clone();
    // Per-face UV scaling so the stone keeps its scale on long beams.
    const uv = g.attributes.uv;
    for (let f = 0; f < 6; f++) {
      const [a, b] = f < 2 ? [d, h] : f < 4 ? [w, d] : [w, h];
      for (let k = 0; k < 4; k++) {
        const i = f * 4 + k;
        uv.setXY(i, (uv.getX(i) * a) / texel, (uv.getY(i) * b) / texel);
      }
    }
    this.addMatrix(g, _m, tint);
    g.dispose();
    return this;
  }

  addMatrix(geo: BufferGeometry, m: Matrix4, tint = 0xffffff, uvScale?: [number, number]): this {
    const g = geo.clone();
    g.applyMatrix4(m);
    if (uvScale && g.attributes.uv) {
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * uvScale[0], uv.getY(i) * uvScale[1]);
    }
    if (!g.attributes.normal) g.computeVertexNormals();
    const n = g.attributes.position.count;
    _c.set(tint);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      col[i * 3] = _c.r;
      col[i * 3 + 1] = _c.g;
      col[i * 3 + 2] = _c.b;
    }
    g.setAttribute('color', new BufferAttribute(col, 3));
    this.parts.push(g);
    return this;
  }

  build(env?: Bake): Mesh {
    const merged = mergeGeos(this.parts);
    for (const p of this.parts) p.dispose();
    this.parts.length = 0;
    if (env) bakeGeometry(merged, env);
    const mesh = new Mesh(merged, this.material);
    return mesh;
  }
}

/** Merge geometries (position, normal, uv, color), keeping indices. */
export function mergeGeos(list: BufferGeometry[]): BufferGeometry {
  let verts = 0;
  let idx = 0;
  for (const g of list) {
    verts += g.attributes.position.count;
    idx += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(verts * 3);
  const nor = new Float32Array(verts * 3);
  const uv = new Float32Array(verts * 2);
  const col = new Float32Array(verts * 3).fill(1);
  const index = verts > 65535 ? new Uint32Array(idx) : new Uint16Array(idx);
  let vo = 0;
  let io = 0;
  for (const g of list) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array as Float32Array, vo * 3);
    if (g.attributes.normal) nor.set(g.attributes.normal.array as Float32Array, vo * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array as Float32Array, vo * 2);
    if (g.attributes.color) col.set(g.attributes.color.array as Float32Array, vo * 3);
    if (g.index) {
      const a = g.index.array;
      for (let i = 0; i < a.length; i++) index[io + i] = a[i] + vo;
      io += a.length;
    } else {
      for (let i = 0; i < n; i++) index[io + i] = vo + i;
      io += n;
    }
    vo += n;
  }
  const out = new BufferGeometry();
  out.setAttribute('position', new BufferAttribute(pos, 3));
  out.setAttribute('normal', new BufferAttribute(nor, 3));
  out.setAttribute('uv', new BufferAttribute(uv, 2));
  out.setAttribute('color', new BufferAttribute(col, 3));
  out.setIndex(new BufferAttribute(index, 1));
  out.computeBoundingSphere();
  return out;
}

/** Unlit material for baked scenery: texture × baked vertex colour. */
export function bakedMat(map?: CanvasTexture | null, opts: { side?: typeof DoubleSide; color?: number; transparent?: boolean; alphaTest?: number } = {}): MeshBasicMaterial {
  const m = new MeshBasicMaterial({ map: map ?? null, vertexColors: true, color: opts.color ?? 0xffffff });
  if (opts.side !== undefined) m.side = opts.side;
  if (opts.transparent) m.transparent = true;
  if (opts.alphaTest !== undefined) m.alphaTest = opts.alphaTest;
  return m;
}

/** Bake a standalone mesh in its parent's space. */
export function bakeMesh(mesh: Mesh, env: Bake): Mesh {
  mesh.updateMatrix();
  const g = mesh.geometry.clone();
  g.applyMatrix4(mesh.matrix);
  bakeGeometry(g, env);
  // Store baked colours back on an untransformed copy.
  const local = mesh.geometry.clone();
  local.setAttribute('color', g.attributes.color);
  mesh.geometry = local;
  g.dispose();
  return mesh;
}

// ---------------------------------------------------------------------------
// Shapes

/** Lathe from [radius, y] pairs. */
export function lathe(profile: number[], segs = 24): LatheGeometry {
  const pts: Vector2[] = [];
  for (let i = 0; i + 1 < profile.length; i += 2) pts.push(new Vector2(profile[i], profile[i + 1]));
  return new LatheGeometry(pts, segs);
}

/** A column shaft with real vertical flutes (unit height, centred at y = 0.5). */
export function fluted(r: number, rTop: number, flutes = 16, depth = 0.06, hSegs = 6): BufferGeometry {
  const g = new CylinderGeometry(rTop, r, 1, flutes * 4, hSegs, true);
  g.translate(0, 0.5, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const z = p.getZ(i);
    const a = Math.atan2(z, x);
    const rr = Math.hypot(x, z);
    const k = 1 - depth * Math.pow(Math.abs(Math.sin((a * flutes) / 2)), 0.6);
    p.setXYZ(i, (x / rr) * rr * k, p.getY(i), (z / rr) * rr * k);
  }
  g.computeVertexNormals();
  return g;
}

/** A craggy rock: displaced icosphere, faceted. */
export function rock(seed: number, detail = 2, jag = 0.35, squash = 1): BufferGeometry {
  const g = new IcosahedronGeometry(1, detail);
  const p = g.attributes.position;
  const o = seed * 13.7;
  for (let i = 0; i < p.count; i++) {
    _v.fromBufferAttribute(p, i);
    const n = noise3(_v.x * 1.9 + o, _v.y * 1.9 - o, _v.z * 1.9 + o * 0.5);
    _v.multiplyScalar(1 + n * jag);
    _v.y *= squash;
    p.setXYZ(i, _v.x, _v.y, _v.z);
  }
  g.computeVertexNormals();
  return g;
}

/**
 * A floating island's underside: an inverted craggy cone with stalactites,
 * flat top at y = 0, radius 1, depth `depth`.
 */
export function islandRock(seed: number, depth = 2.4): BufferGeometry {
  const segs = 28;
  const rings = 9;
  const g = new CylinderGeometry(1, 0.02, depth, segs, rings, false);
  g.translate(0, -depth / 2, 0);
  const p = g.attributes.position;
  const o = seed * 7.1;
  for (let i = 0; i < p.count; i++) {
    _v.fromBufferAttribute(p, i);
    const a = Math.atan2(_v.z, _v.x);
    const t = -_v.y / depth; // 0 top → 1 tip
    const rr = Math.hypot(_v.x, _v.z);
    if (rr < 1e-4) continue;
    const spike = Math.pow(Math.abs(Math.sin(a * 5 + o) * Math.sin(a * 3 - o * 0.7)), 2) * 0.55;
    const n = noise3(Math.cos(a) * 2 + o, t * 4, Math.sin(a) * 2 - o);
    // Stalactite lobes hang lower; the rim bulges out.
    const k = 1 + n * 0.22 + (t < 0.12 ? 0.08 : 0);
    _v.x *= k;
    _v.z *= k;
    _v.y -= spike * depth * t * 0.9 + n * 0.15 * t;
    p.setXYZ(i, _v.x, _v.y, _v.z);
  }
  g.computeVertexNormals();
  return g;
}

/** An arch outline: rectangle of width w, springing at height h, with a round / pointed / keyhole head. */
export function archShape(w: number, h: number, kind: 'round' | 'pointed' | 'keyhole' | 'cusped' = 'round', s = new Shape()): Shape {
  const hw = w / 2;
  s.moveTo(-hw, 0);
  s.lineTo(hw, 0);
  s.lineTo(hw, h);
  if (kind === 'round') s.absarc(0, h, hw, 0, Math.PI, false);
  else if (kind === 'pointed') {
    // Two arcs centred on the opposite springing points meet in a point.
    const steps = 12;
    for (let i = 1; i <= steps; i++) {
      const a = (i / steps) * (Math.PI / 3);
      s.lineTo(-hw + Math.cos(a) * w, h + Math.sin(a) * w);
    }
    for (let i = steps - 1; i >= 0; i--) {
      const a = (i / steps) * (Math.PI / 3);
      s.lineTo(hw - Math.cos(a) * w, h + Math.sin(a) * w);
    }
  } else if (kind === 'keyhole') {
    s.lineTo(hw * 0.75, h);
    s.absarc(0, h + hw * 0.9, hw * 1.15, -Math.asin(0.65), Math.PI + Math.asin(0.65), false);
    s.lineTo(-hw, h);
  } else {
    // Cusped (Indian multi-foil) arch: scalloped lobes around a pointed head.
    const lobes = 7;
    const r = hw;
    for (let i = 0; i <= lobes; i++) {
      const a = (i / lobes) * Math.PI;
      const ax = Math.cos(a) * r;
      const ay = h + Math.sin(a) * r * 1.15;
      if (i === 0) s.lineTo(ax, ay);
      else {
        const am = ((i - 0.5) / lobes) * Math.PI;
        s.quadraticCurveTo(Math.cos(am) * r * 0.82, h + Math.sin(am) * r * 0.95, ax, ay);
      }
    }
  }
  s.lineTo(-hw, 0);
  return s;
}

/** An arch *band* (outer arch minus inner arch) as one hole-free shape, open at the bottom. */
export function archBand(wOut: number, wIn: number, h: number, kind: 'round' | 'pointed' | 'keyhole' | 'cusped' = 'round', hIn = h): Shape {
  const outer = archShape(wOut, h, kind).getPoints(10);
  const inner = archShape(wIn, hIn, kind).getPoints(10);
  // Points run (-w,0) → (w,0) → up the right side → over → down to (-w,0): drop the bottom edge.
  const o = outer.slice(1);
  const i = inner.slice(1).reverse();
  const s = new Shape();
  s.moveTo(o[0].x, o[0].y);
  for (const p of o.slice(1)) s.lineTo(p.x, p.y);
  for (const p of i) s.lineTo(p.x, p.y);
  s.lineTo(o[0].x, o[0].y);
  return s;
}

// ---------------------------------------------------------------------------
// Glow

/** One Points draw call for many glowing things (flames, fireflies, motes). */
export function glowPoints(positions: number[], color: number, size: number, opacity = 1, additive = true): Points {
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
  const p = new Points(
    geo,
    new PointsMaterial({ map: soft(), color, size, sizeAttenuation: true, transparent: true, opacity, depthWrite: false, blending: additive ? AdditiveBlending : undefined, fog: false }),
  );
  p.frustumCulled = false;
  p.renderOrder = 2;
  return p;
}

/** Camera-independent glow quads (stable in VR, unlike Points near the view edge). */
export function glowCards(spots: [number, number, number, number][], color: number, opacity = 1, faceTo = new Vector3(0, EYE_Y, 0)): InstancedMesh {
  const mat = new MeshBasicMaterial({ map: soft(), color, transparent: true, opacity, blending: AdditiveBlending, depthWrite: false, fog: false, side: DoubleSide });
  const m = new InstancedMesh(new PlaneGeometry(1, 1), mat, spots.length);
  const look = new Matrix4();
  spots.forEach(([x, y, z, s], i) => {
    _p.set(x, y, z);
    look.lookAt(faceTo, _p, UP);
    _q.setFromRotationMatrix(look);
    _m.compose(_p, _q, _s.set(s, s, s));
    m.setMatrixAt(i, _m);
  });
  m.instanceMatrix.needsUpdate = true;
  m.renderOrder = 3;
  m.frustumCulled = false;
  return m;
}

/** A soft beam of light (god ray) from `from` to `to`. */
let shaftTex: CanvasTexture | undefined;
export function lightShaft(from: Vector3, to: Vector3, r0: number, r1: number, color: number, opacity: number): Mesh {
  if (!shaftTex) {
    const [c, ctx] = canvas(64, 128);
    const g = ctx.createLinearGradient(0, 0, 0, 128);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.15, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.7, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 128);
    // Soft edges around the cone so it never shows a hard silhouette.
    const e = ctx.createLinearGradient(0, 0, 64, 0);
    e.addColorStop(0, 'rgba(0,0,0,1)');
    e.addColorStop(0.3, 'rgba(0,0,0,0)');
    e.addColorStop(0.7, 'rgba(0,0,0,0)');
    e.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = e;
    ctx.fillRect(0, 0, 64, 128);
    shaftTex = new CanvasTexture(c);
  }
  const dir = new Vector3().subVectors(to, from);
  const len = dir.length();
  const m = new Mesh(
    new CylinderGeometry(r0, r1, len, 20, 1, true),
    new MeshBasicMaterial({ color, map: shaftTex, transparent: true, opacity, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, fog: false }),
  );
  m.position.addVectors(from, to).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new Vector3(0, -1, 0), dir.normalize());
  m.renderOrder = 3;
  return m;
}

export const UP = new Vector3(0, 1, 0);

// ---------------------------------------------------------------------------
// World contract

export type WorldId = 'theatre' | 'forest' | 'castle' | 'sky' | 'realm';

export interface WorldLook {
  /** Shadow-wall tint (must stay light enough for hand shadows to read). */
  wallTint: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  fog: import('@iwsdk/core').FogExp2 | null;
  /** Image-based lighting for reflections (filled in by Worlds.set). */
  env?: import('@iwsdk/core').Texture | null;
  /** The shadow wall's surface in this world (covers the whole wall once). */
  wallMap?: import('@iwsdk/core').Texture | null;
}

export interface WorldSet {
  root: import('@iwsdk/core').Group;
  look: WorldLook;
  /** Bright spots baked into this world's reflection map: [x, y, z, color, strength]. */
  envLights?: [number, number, number, number, number][];
  update(dt: number, t: number, hands: Vector3[]): void;
  /** Something magical happened (a creature appeared): react to it. */
  react(): void;
}

/** Keep scenery out of the play space: the player, the wall, and the battlefield beyond it. */
export function clearOfPlay(x: number, z: number, arena = true): boolean {
  if (Math.hypot(x, z) < 1.7) return false;
  if (z < WALL_Z + 0.5 && z > WALL_Z - 1.2 && Math.abs(x) < 4.2) return false;
  // Battle arena behind the wall: monsters come from up to ~9 m away.
  if (arena && z < WALL_Z && z > -12 && Math.abs(x) < 4.6 + (-z - 1.5) * 0.35) return false;
  return true;
}

/** Simple tiling helper: set repeat on a texture copy. */
export function tiled(t: CanvasTexture, u: number, v = u): CanvasTexture {
  const c = t.clone();
  c.repeat.set(u, v);
  c.needsUpdate = true;
  return c;
}

export { DoubleSide };
