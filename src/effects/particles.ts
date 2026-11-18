import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, Points, ShaderMaterial, Vector3 } from '@iwsdk/core';

const vertex = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vAlpha = aAlpha;
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * (300.0 / -mv.z);
}`;

const fragment = /* glsl */ `
varying float vAlpha;
varying vec3 vColor;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float d = dot(p, p);
  if (d > 1.0) discard;
  float a = exp(-d * 3.5) * vAlpha;
  gl_FragColor = vec4(vColor * (1.0 + exp(-d * 12.0)), a);
}`;

const GOLD = new Color(1.0, 0.72, 0.32);
const PURPLE = new Color(0.66, 0.42, 1.0);

/**
 * One pooled particle system (a single Points draw call) for every magical
 * effect: transformation bursts, sparks gathering into the hold ring, and the
 * ambient dust drifting through the candlelight. No per-frame allocation.
 */
export class Particles {
  readonly points: Points;
  private readonly n: number;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly size: Float32Array;
  private readonly baseSize: Float32Array;
  private readonly alpha: Float32Array;
  private readonly color: Float32Array;
  /** Indices [0, dustCount) are ambient dust; the rest is the burst pool. */
  private readonly dustCount: number;
  private next: number;
  /** Room-space volume the dust drifts in (between the player and the wall). */
  private readonly dustMin = new Vector3(-1.6, 0.6, -1.45);
  private readonly dustMax = new Vector3(1.6, 2.6, -0.3);
  intensity = 1;

  constructor(pool = 420, dust = 90) {
    this.n = pool + dust;
    this.dustCount = dust;
    this.next = dust;
    this.pos = new Float32Array(this.n * 3);
    this.vel = new Float32Array(this.n * 3);
    this.life = new Float32Array(this.n);
    this.maxLife = new Float32Array(this.n);
    this.size = new Float32Array(this.n);
    this.baseSize = new Float32Array(this.n);
    this.alpha = new Float32Array(this.n);
    this.color = new Float32Array(this.n * 3);
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(this.pos, 3));
    g.setAttribute('aSize', new BufferAttribute(this.size, 1));
    g.setAttribute('aAlpha', new BufferAttribute(this.alpha, 1));
    g.setAttribute('aColor', new BufferAttribute(this.color, 3));
    this.points = new Points(
      g,
      new ShaderMaterial({ vertexShader: vertex, fragmentShader: fragment, transparent: true, depthWrite: false, blending: AdditiveBlending }),
    );
    this.points.frustumCulled = false;
    this.points.renderOrder = 8;
    for (let i = 0; i < dust; i++) this.respawnDust(i, true);
  }

  private respawnDust(i: number, anywhere: boolean): void {
    const r = Math.random;
    const lo = this.dustMin;
    const hi = this.dustMax;
    this.pos[i * 3] = lo.x + r() * (hi.x - lo.x);
    this.pos[i * 3 + 1] = anywhere ? lo.y + r() * (hi.y - lo.y) : lo.y;
    this.pos[i * 3 + 2] = lo.z + r() * (hi.z - lo.z);
    this.vel[i * 3] = (r() - 0.5) * 0.02;
    this.vel[i * 3 + 1] = 0.01 + r() * 0.03;
    this.vel[i * 3 + 2] = (r() - 0.5) * 0.02;
    this.maxLife[i] = 8 + r() * 10;
    this.life[i] = anywhere ? r() * this.maxLife[i] : 0;
    this.baseSize[i] = 0.01 + r() * 0.014;
    const c = r() < 0.25 ? PURPLE : GOLD;
    this.color[i * 3] = c.r;
    this.color[i * 3 + 1] = c.g;
    this.color[i * 3 + 2] = c.b;
  }

  private spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, c: Color): void {
    const i = this.next;
    this.next = this.next + 1 >= this.n ? this.dustCount : this.next + 1;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.life[i] = 0;
    this.maxLife[i] = life;
    this.baseSize[i] = size;
    this.color[i * 3] = c.r;
    this.color[i * 3 + 1] = c.g;
    this.color[i * 3 + 2] = c.b;
  }

  /** 1 = full, 0.4 = low, 0 = off (Settings). Scales spark counts and dust. */
  level = 1;

  /** A swirling burst of gold and purple sparks: a shadow comes alive. */
  burst(at: Vector3, count = 70, spread = 0.5): void {
    count = Math.round(count * this.level);
    for (let k = 0; k < count; k++) {
      const a = Math.random() * Math.PI * 2;
      const s = spread * (0.3 + Math.random());
      this.spawn(
        at.x,
        at.y,
        at.z + 0.02,
        Math.cos(a) * s,
        Math.sin(a) * s + 0.15,
        0.05 + Math.random() * 0.1,
        0.8 + Math.random() * 0.9,
        0.045 + Math.random() * 0.06,
        Math.random() < 0.45 ? PURPLE : GOLD,
      );
    }
  }

  /** Sparks drawn inward to a point (the filling hold ring). */
  gather(at: Vector3, radius: number, amount: number): void {
    if (Math.random() > this.level) return;
    for (let k = 0; k < amount; k++) {
      const a = Math.random() * Math.PI * 2;
      const x = at.x + Math.cos(a) * radius;
      const y = at.y + Math.sin(a) * radius;
      this.spawn(x, y, at.z + 0.015, (at.x - x) * 1.6, (at.y - y) * 1.6, 0, 0.6, 0.03 + Math.random() * 0.025, Math.random() < 0.5 ? GOLD : PURPLE);
    }
  }

  update(dt: number): void {
    const swirl = 1.2;
    for (let i = 0; i < this.n; i++) {
      const dust = i < this.dustCount;
      this.life[i] += dt;
      if (dust && this.life[i] > this.maxLife[i]) this.respawnDust(i, false);
      const t = this.life[i] / this.maxLife[i];
      if (!dust && t >= 1) {
        this.alpha[i] = 0;
        this.size[i] = 0;
        continue;
      }
      const o = i * 3;
      let vx = this.vel[o];
      let vy = this.vel[o + 1];
      if (!dust) {
        // Gentle swirl + drag so bursts curl and settle like magic dust.
        const nvx = vx - vy * swirl * dt;
        vy = vy + vx * swirl * dt - 0.05 * dt;
        vx = nvx * (1 - 1.2 * dt);
        vy *= 1 - 1.2 * dt;
        this.vel[o] = vx;
        this.vel[o + 1] = vy;
      } else {
        vx += Math.sin(this.life[i] * 0.7 + i) * 0.002 * dt;
      }
      this.pos[o] += vx * dt;
      this.pos[o + 1] += vy * dt;
      this.pos[o + 2] += this.vel[o + 2] * dt;
      const fade = dust ? Math.sin(Math.min(1, t) * Math.PI) * 0.55 : (1 - t) * (t < 0.1 ? t * 10 : 1);
      this.alpha[i] = fade * this.intensity * (dust ? this.level : 1);
      this.size[i] = this.baseSize[i] * (dust ? 1 : 1 - t * 0.5);
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
    g.attributes.aAlpha.needsUpdate = true;
    g.attributes.aColor.needsUpdate = true;
  }
}
