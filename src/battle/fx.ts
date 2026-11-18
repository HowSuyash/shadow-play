import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Points,
  PointsMaterial,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  Vector3,
  type MeshStandardMaterialParameters,
} from '@iwsdk/core';

/** Soft round glow used by sparks, halos and orbs (made once, shared). */
let softTex: CanvasTexture | undefined;
export function softTexture(): CanvasTexture {
  if (softTex) return softTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.75)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.18)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  softTex = new CanvasTexture(c);
  softTex.colorSpace = SRGBColorSpace;
  return softTex;
}

/** An additive glow sprite (halo around flames, eyes, orbs and cores). */
export function halo(color: number, size: number, opacity = 0.9): Sprite {
  const s = new Sprite(
    new SpriteMaterial({ map: softTexture(), color, transparent: true, opacity, blending: AdditiveBlending, depthWrite: false, fog: false }),
  );
  s.scale.setScalar(size);
  return s;
}

/** Plain glowing material (eyes, runes, cores). */
export function glowMat(color: number, opacity = 1): MeshBasicMaterial {
  return new MeshBasicMaterial({ color, transparent: opacity < 1, opacity, fog: false, toneMapped: false });
}

/**
 * Standard material with a fresnel rim light and a hit-flash uniform, so dark
 * shadow monsters always read against any world, and flash gold when struck.
 */
export function rimMaterial(params: MeshStandardMaterialParameters, rim: number, rimPower = 2.2): MeshStandardMaterial & { flash: { value: number }; rimStrength: { value: number } } {
  const m = new MeshStandardMaterial(params) as MeshStandardMaterial & { flash: { value: number }; rimStrength: { value: number } };
  // Monsters stay crisp silhouettes even deep in a world's fog.
  m.fog = false;
  const flash = { value: 0 };
  const rimStrength = { value: 1 };
  const rimColor = { value: new Color(rim) };
  m.flash = flash;
  m.rimStrength = rimStrength;
  m.onBeforeCompile = (s) => {
    s.uniforms.uFlash = flash;
    s.uniforms.uRim = rimColor;
    s.uniforms.uRimStrength = rimStrength;
    s.fragmentShader = 'uniform float uFlash;\nuniform vec3 uRim;\nuniform float uRimStrength;\n' + s.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      float rimK = pow(1.0 - clamp(abs(dot(normalize(vViewPosition), normal)), 0.0, 1.0), ${rimPower.toFixed(2)});
      totalEmissiveRadiance += uRim * rimK * uRimStrength + vec3(1.0, 0.78, 0.35) * uFlash;`,
    );
  };
  m.customProgramCacheKey = () => `rim${rimPower}`;
  return m;
}

// ---------------------------------------------------------------------------
// 3D sparks: impacts, deaths, summons. One pooled Points cloud, no allocation.
// ---------------------------------------------------------------------------

export class Sparks {
  readonly points: Points;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly base: Float32Array;
  private readonly drag: Float32Array;
  private readonly grav: Float32Array;
  private next = 0;
  /** 0..1 effects quality (Settings). */
  level = 1;
  private readonly c = new Color();

  constructor(private readonly n = 900) {
    this.pos = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.base = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.maxLife = new Float32Array(n).fill(1);
    this.drag = new Float32Array(n);
    this.grav = new Float32Array(n);
    for (let i = 0; i < n; i++) this.pos[i * 3 + 1] = -999;
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(this.pos, 3));
    g.setAttribute('color', new BufferAttribute(this.col, 3));
    this.points = new Points(
      g,
      new PointsMaterial({
        size: 0.05,
        map: softTexture(),
        vertexColors: true,
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: true,
        fog: false,
      }),
    );
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  /** A spherical burst of `count` sparks at `at`. */
  burst(at: Vector3, count: number, speed: number, color: number, life = 0.7, gravity = 1.5, dir?: Vector3, spread = 1): void {
    count = Math.round(count * this.level);
    this.c.set(color);
    for (let k = 0; k < count; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.n;
      // Random direction on the sphere, biased toward dir.
      let x = Math.random() * 2 - 1;
      let y = Math.random() * 2 - 1;
      let z = Math.random() * 2 - 1;
      const l = Math.hypot(x, y, z) || 1;
      x /= l;
      y /= l;
      z /= l;
      if (dir) {
        x = x * spread + dir.x;
        y = y * spread + dir.y;
        z = z * spread + dir.z;
      }
      const s = speed * (0.35 + Math.random() * 0.9);
      this.pos[i * 3] = at.x;
      this.pos[i * 3 + 1] = at.y;
      this.pos[i * 3 + 2] = at.z;
      this.vel[i * 3] = x * s;
      this.vel[i * 3 + 1] = y * s;
      this.vel[i * 3 + 2] = z * s;
      const v = 0.7 + Math.random() * 0.5;
      this.base[i * 3] = this.c.r * v;
      this.base[i * 3 + 1] = this.c.g * v;
      this.base[i * 3 + 2] = this.c.b * v;
      this.maxLife[i] = this.life[i] = life * (0.5 + Math.random() * 0.8);
      this.drag[i] = 1.8;
      this.grav[i] = gravity;
    }
  }

  /** Sparks drawn in from a sphere toward `at` (a weapon forming). */
  gather(at: Vector3, radius: number, count: number, color: number): void {
    count = Math.round(count * this.level);
    this.c.set(color);
    for (let k = 0; k < count; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.n;
      let x = Math.random() * 2 - 1;
      let y = Math.random() * 2 - 1;
      let z = Math.random() * 2 - 1;
      const l = Math.hypot(x, y, z) || 1;
      x /= l;
      y /= l;
      z /= l;
      const t = 0.35;
      this.pos[i * 3] = at.x + x * radius;
      this.pos[i * 3 + 1] = at.y + y * radius;
      this.pos[i * 3 + 2] = at.z + z * radius;
      this.vel[i * 3] = (-x * radius) / t;
      this.vel[i * 3 + 1] = (-y * radius) / t;
      this.vel[i * 3 + 2] = (-z * radius) / t;
      this.base[i * 3] = this.c.r;
      this.base[i * 3 + 1] = this.c.g;
      this.base[i * 3 + 2] = this.c.b;
      this.maxLife[i] = this.life[i] = t;
      this.drag[i] = 0;
      this.grav[i] = 0;
    }
  }

  update(dt: number): void {
    const p = this.pos;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const i3 = i * 3;
      if (this.life[i] <= 0) {
        p[i3 + 1] = -999;
        this.col[i3] = this.col[i3 + 1] = this.col[i3 + 2] = 0;
        continue;
      }
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i3] *= d;
      this.vel[i3 + 1] = this.vel[i3 + 1] * d - this.grav[i] * dt;
      this.vel[i3 + 2] *= d;
      p[i3] += this.vel[i3] * dt;
      p[i3 + 1] += this.vel[i3 + 1] * dt;
      p[i3 + 2] += this.vel[i3 + 2] * dt;
      const k = this.life[i] / this.maxLife[i];
      const f = k * k;
      this.col[i3] = this.base[i3] * f;
      this.col[i3 + 1] = this.base[i3 + 1] * f;
      this.col[i3 + 2] = this.base[i3 + 2] * f;
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
  }

  clear(): void {
    this.life.fill(0);
    this.col.fill(0);
    for (let i = 0; i < this.n; i++) this.pos[i * 3 + 1] = -999;
  }
}

// ---------------------------------------------------------------------------
// Swing trail: a fading ribbon between two moving points (blade base/tip).
// ---------------------------------------------------------------------------

export class Trail {
  readonly mesh: Mesh;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly ages: Float32Array;
  private count = 0;
  private readonly color = new Color();

  constructor(
    private readonly n: number,
    color: number,
    private readonly fade = 0.18,
  ) {
    this.color.set(color);
    this.pos = new Float32Array(n * 2 * 3);
    this.col = new Float32Array(n * 2 * 3);
    this.ages = new Float32Array(n);
    const idx: number[] = [];
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(this.pos, 3));
    g.setAttribute('color', new BufferAttribute(this.col, 3));
    g.setIndex(idx);
    this.mesh = new Mesh(
      g,
      new MeshBasicMaterial({ vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, fog: false, toneMapped: false }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
  }

  /** Add the newest edge (a, b). `strength` 0..1 scales its brightness. */
  push(a: Vector3, b: Vector3, dt: number, strength: number): void {
    // Shift everything one slot back (n is small: ~16).
    this.pos.copyWithin(6, 0, (this.n - 1) * 6);
    this.ages.copyWithin(1, 0, this.n - 1);
    this.str.copyWithin(1, 0, this.n - 1);
    this.pos[0] = a.x;
    this.pos[1] = a.y;
    this.pos[2] = a.z;
    this.pos[3] = b.x;
    this.pos[4] = b.y;
    this.pos[5] = b.z;
    this.ages[0] = 0;
    this.str[0] = strength;
    for (let i = 1; i < this.n; i++) this.ages[i] += dt;
    this.count = Math.min(this.n, this.count + 1);
    // Brightness: each edge keeps the strength it was born with, fading with age.
    const r = this.color.r;
    const gg = this.color.g;
    const bb = this.color.b;
    for (let i = 0; i < this.n; i++) {
      const k = i >= this.count ? 0 : Math.max(0, 1 - this.ages[i] / this.fade) * this.str[i];
      this.col[i * 6] = r * k * 0.5; // inner (hand) edge dimmer
      this.col[i * 6 + 1] = gg * k * 0.5;
      this.col[i * 6 + 2] = bb * k * 0.5;
      this.col[i * 6 + 3] = r * k;
      this.col[i * 6 + 4] = gg * k;
      this.col[i * 6 + 5] = bb * k;
    }
    const g = this.mesh.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
  }

  private readonly str = new Float32Array(64);

  reset(): void {
    this.count = 0;
    this.col.fill(0);
    this.str.fill(0);
    this.mesh.geometry.attributes.color.needsUpdate = true;
  }
}

/** Distance from point p to segment ab. */
export function segmentDistance(p: Vector3, a: Vector3, b: Vector3): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const len2 = abx * abx + aby * aby + abz * abz;
  let t = len2 > 1e-9 ? ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const x = a.x + abx * t - p.x;
  const y = a.y + aby * t - p.y;
  const z = a.z + abz * t - p.z;
  return Math.sqrt(x * x + y * y + z * z);
}
