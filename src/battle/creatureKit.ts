import {
  BufferGeometry,
  CanvasTexture,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  LatheGeometry,
  NormalBlending,
  AdditiveBlending,
  Points,
  PointsMaterial,
  RepeatWrapping,
  SphereGeometry,
  SRGBColorSpace,
  Vector2,
  Vector3,
} from '@iwsdk/core';

/**
 * Dark-fantasy creature toolkit: painted shadow-flesh, scarred iron, bone and
 * tattered-cloth textures with glowing corruption veins; curved claws and
 * horns; tapered muscular limbs; and drifting shadow smoke with embers.
 * Textures are painted once and shared by every monster.
 */

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function canvas(w: number, h = w): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function tex(c: HTMLCanvasElement, srgb = true): CanvasTexture {
  const t = new CanvasTexture(c);
  if (srgb) t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** Cheap tileable value noise (fBm), size×size, 0..1. */
function noise(size: number, seed: number, octaves = 4, base = 4): Float32Array {
  const out = new Float32Array(size * size);
  const r = rng(seed);
  let amp = 1;
  let tot = 0;
  for (let o = 0; o < octaves; o++) {
    const f = base << o;
    const g = new Float32Array(f * f);
    for (let i = 0; i < g.length; i++) g[i] = r();
    for (let y = 0; y < size; y++) {
      const gy = (y / size) * f;
      const y0 = Math.floor(gy);
      const ty = gy - y0;
      const sy = ty * ty * (3 - 2 * ty);
      for (let x = 0; x < size; x++) {
        const gx = (x / size) * f;
        const x0 = Math.floor(gx);
        const tx = gx - x0;
        const sx = tx * tx * (3 - 2 * tx);
        const a = g[(y0 % f) * f + (x0 % f)];
        const b = g[(y0 % f) * f + ((x0 + 1) % f)];
        const c = g[((y0 + 1) % f) * f + (x0 % f)];
        const d = g[((y0 + 1) % f) * f + ((x0 + 1) % f)];
        out[y * size + x] += (a + (b - a) * sx + (c - a + (a - b + d - c) * sx) * sy) * amp;
      }
    }
    tot += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= tot;
  return out;
}

/** Branching glowing veins (for emissive maps). */
function veins(ctx: CanvasRenderingContext2D, S: number, seed: number, n: number, color: string, width: number): void {
  const r = rng(seed);
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  const branch = (x: number, y: number, a: number, len: number, w: number, depth: number) => {
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let s = 0; s < len; s++) {
      a += (r() - 0.5) * 0.9;
      x += Math.cos(a) * 9;
      y += Math.sin(a) * 9;
      ctx.lineTo(x, y);
      if (depth < 2 && r() < 0.12) {
        ctx.stroke();
        branch(x, y, a + (r() < 0.5 ? 0.8 : -0.8), len * 0.5, w * 0.6, depth + 1);
        ctx.lineWidth = w;
        ctx.beginPath();
        ctx.moveTo(x, y);
      }
    }
    ctx.stroke();
  };
  for (let k = 0; k < n; k++) for (const dx of [0]) branch(r() * S + dx, r() * S, r() * Math.PI * 2, 10 + r() * 16, width * (0.6 + r() * 0.8), 0);
}

let skin: { map: CanvasTexture; emissive: CanvasTexture } | undefined;
/** Shadow flesh: near-black, leathery and cracked, with violet corruption veins. */
export function skinTextures(): { map: CanvasTexture; emissive: CanvasTexture } {
  if (skin) return skin;
  const S = 512;
  const n = noise(S, 11, 5, 4);
  const f = noise(S, 12, 3, 48);
  const [c, ctx] = canvas(S);
  const img = ctx.createImageData(S, S);
  for (let i = 0; i < S * S; i++) {
    // Leathery cells: fine noise thresholded into wrinkles.
    const cell = Math.abs(f[i] - 0.5) < 0.03 ? 0.55 : 1;
    const k = (0.55 + n[i] * 0.7) * cell;
    img.data[i * 4] = 46 * k;
    img.data[i * 4 + 1] = 38 * k;
    img.data[i * 4 + 2] = 54 * k;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const [e, ectx] = canvas(S);
  ectx.fillStyle = '#000';
  ectx.fillRect(0, 0, S, S);
  ectx.shadowColor = '#c050ff';
  ectx.shadowBlur = 8;
  veins(ectx, S, 13, 5, 'rgba(170,70,255,0.85)', 2);
  ectx.shadowBlur = 0;
  veins(ectx, S, 14, 3, 'rgba(255,160,255,0.7)', 0.8);
  skin = { map: tex(c), emissive: tex(e) };
  return skin;
}

let iron: { map: CanvasTexture; emissive: CanvasTexture } | undefined;
/** Scarred blackened iron plate with rivets, and molten violet cracks. */
export function ironTextures(): { map: CanvasTexture; emissive: CanvasTexture } {
  if (iron) return iron;
  const S = 512;
  const n = noise(S, 21, 5, 4);
  const [c, ctx] = canvas(S);
  const img = ctx.createImageData(S, S);
  for (let i = 0; i < S * S; i++) {
    const k = 0.6 + n[i] * 0.6;
    img.data[i * 4] = 62 * k;
    img.data[i * 4 + 1] = 60 * k;
    img.data[i * 4 + 2] = 68 * k;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const r = rng(22);
  // Scratches.
  for (let k = 0; k < 140; k++) {
    ctx.strokeStyle = r() < 0.5 ? 'rgba(170,165,180,0.25)' : 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1;
    const x = r() * S;
    const y = r() * S;
    const a = r() * Math.PI;
    const l = 10 + r() * 50;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    ctx.stroke();
  }
  // Plate seams and rivets.
  for (let y = 0; y < S; y += 128) {
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, y, S, 4);
    ctx.fillStyle = 'rgba(200,195,210,0.25)';
    ctx.fillRect(0, y + 4, S, 2);
    for (let x = 16; x < S; x += 40) {
      ctx.fillStyle = 'rgba(20,18,24,0.9)';
      ctx.beginPath();
      ctx.arc(x, y + 14, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(220,215,230,0.45)';
      ctx.beginPath();
      ctx.arc(x - 1.5, y + 12.5, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const [e, ectx] = canvas(S);
  ectx.fillStyle = '#000';
  ectx.fillRect(0, 0, S, S);
  ectx.shadowColor = '#ff40c0';
  ectx.shadowBlur = 10;
  veins(ectx, S, 23, 5, 'rgba(230,90,255,0.95)', 3);
  iron = { map: tex(c), emissive: tex(e) };
  return iron;
}

let bone: CanvasTexture | undefined;
/** Old bone / horn: pale, stained, with growth rings. */
export function boneTexture(): CanvasTexture {
  if (bone) return bone;
  const S = 256;
  const n = noise(S, 31, 4, 4);
  const [c, ctx] = canvas(S);
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const ring = 0.85 + 0.15 * Math.sin(y * 0.35 + n[i] * 6);
      const k = (0.55 + n[i] * 0.55) * ring;
      img.data[i * 4] = 178 * k;
      img.data[i * 4 + 1] = 166 * k;
      img.data[i * 4 + 2] = 150 * k;
      img.data[i * 4 + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  bone = tex(c);
  return bone;
}

let cloth: CanvasTexture | undefined;
/** Tattered black cloth: torn hem, holes, frayed threads (use with alphaTest). */
export function clothTexture(): CanvasTexture {
  if (cloth) return cloth;
  const W = 512;
  const H = 512;
  const n = noise(256, 41, 4, 8);
  const [c, ctx] = canvas(W, H);
  const img = ctx.createImageData(W, H);
  const r = rng(42);
  // Ragged hem depth per column (torn into strips toward the bottom).
  const hem = new Float32Array(W);
  for (let x = 0; x < W; x++) {
    const strip = Math.abs(Math.sin(x * 0.05 + Math.sin(x * 0.013) * 3));
    hem[x] = H * (0.62 + 0.36 * Math.pow(strip, 0.6)) - r() * 6;
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const v = n[((y >> 1) & 255) * 256 + ((x >> 1) & 255)];
      const weave = (x + y) % 3 === 0 ? 0.85 : 1;
      const k = (0.5 + v * 0.7) * weave;
      img.data[i] = 30 * k;
      img.data[i + 1] = 26 * k;
      img.data[i + 2] = 40 * k;
      // Holes where the noise dips, and the torn hem.
      const hole = v < 0.3 && y > H * 0.25;
      img.data[i + 3] = y > hem[x] || hole ? 0 : 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  cloth = tex(c);
  return cloth;
}

let smokeTex: CanvasTexture | undefined;
function smokeTexture(): CanvasTexture {
  if (smokeTex) return smokeTex;
  const [c, ctx] = canvas(64);
  const r = rng(51);
  for (let k = 0; k < 14; k++) {
    const x = 20 + r() * 24;
    const y = 20 + r() * 24;
    const rad = 8 + r() * 14;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  }
  smokeTex = new CanvasTexture(c);
  return smokeTex;
}

// ---------------------------------------------------------------------------
// Geometry

/** Bend a +Y-pointing geometry of length `len` toward +Z by `k` radians along its length. */
export function bend<T extends BufferGeometry>(g: T, len: number, k: number): T {
  const p = g.attributes.position;
  const v = new Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const t = Math.max(0, v.y / len);
    const a = t * k;
    const R = len / (k || 1e-6);
    // Map (z, y) along an arc of radius R.
    const y = Math.sin(a) * (R - v.z);
    const z = R - Math.cos(a) * (R - v.z);
    p.setXYZ(i, v.x, k ? y : v.y, k ? z : v.z);
  }
  g.computeVertexNormals();
  return g;
}

/** A curved claw / horn / tooth: base at the origin, curving from +Y toward +Z. */
export function claw(len: number, r: number, curl: number, segs = 6): ConeGeometry {
  const g = new ConeGeometry(r, len, segs, 6);
  g.translate(0, len / 2, 0);
  return bend(g, len, curl);
}

/** A tapered, muscular limb hanging DOWN from its pivot (length `len`). */
export function limb(r0: number, r1: number, len: number, bulge = 0.18, segs = 10): LatheGeometry {
  const pts: Vector2[] = [new Vector2(0, 0)];
  const n = 8;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const r = r0 + (r1 - r0) * t;
    pts.push(new Vector2(r * (1 + bulge * Math.sin(Math.min(1, t * 1.4) * Math.PI)), -t * len));
  }
  pts.push(new Vector2(0, -len));
  const g = new LatheGeometry(pts.reverse(), segs);
  return g;
}

/** A lathe from [radius, y] pairs (bottom to top). */
export function profile(pairs: number[], segs = 14): LatheGeometry {
  const pts: Vector2[] = [];
  for (let i = 0; i + 1 < pairs.length; i += 2) pts.push(new Vector2(pairs[i], pairs[i + 1]));
  return new LatheGeometry(pts, segs);
}

/** An elongated, brow-ridged skull (unit-ish, facing +Z). */
export function skullGeo(): SphereGeometry {
  const g = new SphereGeometry(1, 18, 14);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i);
    let y = p.getY(i);
    let z = p.getZ(i);
    // Long muzzle forward, flat sides, heavy brow, hollow cheeks.
    z *= z > 0 ? 1.45 : 1.05;
    x *= 0.82 - Math.max(0, z) * 0.12;
    if (y > 0.1 && z > 0.3) y += 0.12 * (1 - Math.abs(x) * 1.5);
    if (y < 0) y *= 0.7;
    p.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  return g;
}

/** An open-ended tattered cloth cone (robe, hood, sleeve): top radius r0, bottom r1, hanging down. */
export function robe(r0: number, r1: number, len: number, segs = 20, openFront = 0): CylinderGeometry {
  // `openFront` (radians each side) leaves the front (+Z) open like a parted cloak.
  const g = new CylinderGeometry(r0, r1, len, segs, 6, true, openFront, Math.PI * 2 - openFront * 2);
  g.translate(0, -len / 2, 0);
  // Gentle folds.
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const z = p.getZ(i);
    const a = Math.atan2(z, x);
    const t = -p.getY(i) / len;
    const k = 1 + Math.sin(a * 7) * 0.06 * t;
    p.setXYZ(i, x * k, p.getY(i), z * k);
  }
  g.computeVertexNormals();
  return g;
}

export const CLOTH_SIDE = DoubleSide;

// ---------------------------------------------------------------------------
// Smoke and embers

/**
 * Shadow smoke curling off a creature (dark, normal-blended) or embers rising
 * from it (additive). Local to the creature's model; recycled, no allocation.
 */
export class Wisps {
  readonly points: Points;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly r = rng(Math.floor(Math.random() * 1e6));

  constructor(
    private readonly n: number,
    private readonly radius: number,
    private readonly y0: number,
    private readonly y1: number,
    size: number,
    color: number,
    opacity: number,
    private readonly rise: number,
    embers = false,
  ) {
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.age = new Float32Array(n);
    this.life = new Float32Array(n);
    for (let i = 0; i < n; i++) this.spawn(i, this.r());
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    this.points = new Points(
      g,
      new PointsMaterial({
        map: embers ? undefined : smokeTexture(),
        color,
        size,
        transparent: true,
        opacity,
        depthWrite: false,
        blending: embers ? AdditiveBlending : NormalBlending,
        sizeAttenuation: true,
        fog: false,
      }),
    );
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
  }

  private spawn(i: number, startAge: number): void {
    const a = this.r() * Math.PI * 2;
    const d = Math.sqrt(this.r()) * this.radius;
    this.pos[i * 3] = Math.cos(a) * d;
    this.pos[i * 3 + 1] = this.y0 + this.r() * (this.y1 - this.y0);
    this.pos[i * 3 + 2] = Math.sin(a) * d;
    this.vel[i * 3] = Math.cos(a) * 0.08 + (this.r() - 0.5) * 0.1;
    this.vel[i * 3 + 1] = this.rise * (0.5 + this.r());
    this.vel[i * 3 + 2] = Math.sin(a) * 0.08 + (this.r() - 0.5) * 0.1;
    this.life[i] = 1.2 + this.r() * 1.4;
    this.age[i] = startAge * this.life[i];
  }

  update(dt: number): void {
    for (let i = 0; i < this.n; i++) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) this.spawn(i, 0);
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
    }
    (this.points.geometry.attributes.position as Float32BufferAttribute).needsUpdate = true;
  }
}
