import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  ShaderMaterial,
  SRGBColorSpace,
  Vector3,
} from '@iwsdk/core';
import type { PoseId } from '../hands/poseDetector.js';
import { MENU, STAGE } from '../scene/layout.js';

const PARCHMENT = '#f6dfb0';
const FONT = 'Georgia, "Times New Roman", serif';

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

/** Where a point's shadow lands on the wall stage (room-local), cast from `light`. */
export function projectToWall(point: Vector3, light: Vector3, out: Vector3): Vector3 {
  const dz = point.z - light.z;
  if (dz > -0.02) {
    // Point isn't in front of the candle: fall back to straight-ahead.
    return out.set(point.x, point.y, STAGE.z);
  }
  const t = (STAGE.z - light.z) / dz;
  out.set(light.x + (point.x - light.x) * t, light.y + (point.y - light.y) * t, STAGE.z);
  // Keep UI inside the visible stage.
  out.x = Math.max(STAGE.left, Math.min(STAGE.right, out.x));
  out.y = Math.max(STAGE.groundY - 0.1, Math.min(STAGE.titleY + 0.4, out.y));
  return out;
}

// ---------------------------------------------------------------------------
// Fading helper
// ---------------------------------------------------------------------------

/** A mesh whose material opacity eases toward a target. */
export class Fader {
  target = 0;
  value = 0;
  constructor(
    readonly mesh: Mesh,
    private readonly speed = 3,
  ) {
    (mesh.material as MeshBasicMaterial).opacity = 0;
    mesh.visible = false;
  }
  show(on = true): this {
    this.target = on ? 1 : 0;
    return this;
  }
  hideNow(): void {
    this.target = this.value = 0;
    this.apply();
  }
  update(dt: number): void {
    const step = dt * this.speed;
    this.value += Math.max(-step, Math.min(step, this.target - this.value));
    this.apply();
  }
  private apply(): void {
    (this.mesh.material as MeshBasicMaterial).opacity = this.value;
    this.mesh.visible = this.value > 0.002;
  }
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

export interface TextStyle {
  size?: number; // px on the canvas
  color?: string;
  weight?: string;
  letterSpacing?: number; // px
  italic?: boolean;
  glow?: string;
}

/** Renders lines of warm, glowing text into a transparent plane `height` metres tall. */
export function makeText(lines: string[], height: number, style: TextStyle = {}): Mesh {
  const size = style.size ?? 72;
  const lineH = size * 1.25;
  const pad = size * 0.6;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const font = `${style.italic ? 'italic ' : ''}${style.weight ?? '600'} ${size}px ${FONT}`;
  ctx.font = font;
  const spacing = style.letterSpacing ?? 0;
  const widthOf = (s: string) => ctx.measureText(s).width + spacing * Math.max(0, s.length - 1);
  const w = Math.ceil(Math.max(...lines.map(widthOf)) + pad * 2);
  const h = Math.ceil(lineH * lines.length + pad * 2);
  canvas.width = w;
  canvas.height = h;
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if ('letterSpacing' in ctx) (ctx as unknown as { letterSpacing: string }).letterSpacing = `${spacing}px`;
  ctx.shadowColor = style.glow ?? 'rgba(255,140,40,0.85)';
  ctx.shadowBlur = size * 0.35;
  ctx.fillStyle = style.color ?? PARCHMENT;
  lines.forEach((line, i) => {
    const y = pad + lineH * (i + 0.5);
    ctx.fillText(line, w / 2, y);
    ctx.fillText(line, w / 2, y); // second pass strengthens the glow
  });
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  const mesh = new Mesh(
    new PlaneGeometry((height * w) / h, height),
    new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }),
  );
  mesh.renderOrder = 5;
  return mesh;
}

// ---------------------------------------------------------------------------
// Hold ring
// ---------------------------------------------------------------------------

const ringVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const ringFragment = /* glsl */ `
varying vec2 vUv;
uniform float uProgress;
uniform float uOpacity;
uniform float uTime;
uniform vec3 uColor;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  float band = smoothstep(0.075, 0.0, abs(r - 0.82));
  float glow = exp(-pow((r - 0.82) * 7.0, 2.0)) * 0.55;
  float ang = atan(p.x, p.y);
  float a = (ang < 0.0 ? ang + 6.2831853 : ang) / 6.2831853;
  float filled = step(a, uProgress);
  // Shimmer travelling along the filled arc.
  float shimmer = 0.85 + 0.15 * sin(a * 40.0 - uTime * 8.0);
  float k = mix(0.16, shimmer, filled);
  float alpha = (band + glow) * k * uOpacity;
  gl_FragColor = vec4(uColor * (1.0 + filled * 0.6), alpha);
}`;

/** Glowing ring on the wall that fills clockwise as a pose is held. */
export class HoldRing {
  readonly mesh: Mesh;
  private readonly mat: ShaderMaterial;
  private opacity = 0;
  private targetOpacity = 0;
  private readonly target = new Vector3();

  constructor() {
    this.mat = new ShaderMaterial({
      vertexShader: ringVertex,
      fragmentShader: ringFragment,
      uniforms: {
        uProgress: { value: 0 },
        uOpacity: { value: 0 },
        uTime: { value: 0 },
        uColor: { value: new Color(1.0, 0.62, 0.25) },
      },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.mesh = new Mesh(new PlaneGeometry(0.7, 0.7), this.mat);
    this.mesh.renderOrder = 6;
    this.mesh.visible = false;
  }

  /** @param progress 0..1, or ≤0 to fade out. `at` is a wall position. */
  set(progress: number, at?: Vector3): void {
    this.targetOpacity = progress > 0.02 ? 1 : 0;
    if (progress > 0.02) this.mat.uniforms.uProgress.value = progress;
    if (at) this.target.copy(at);
  }

  update(dt: number, time: number): void {
    this.opacity += (this.targetOpacity - this.opacity) * Math.min(1, dt * 10);
    this.mesh.visible = this.opacity > 0.01;
    this.mat.uniforms.uOpacity.value = this.opacity;
    this.mat.uniforms.uTime.value = time;
    // Follow the shadow smoothly; snap if we were hidden.
    if (this.opacity < 0.05) this.mesh.position.copy(this.target);
    else this.mesh.position.lerp(this.target, Math.min(1, dt * 12));
    this.mesh.position.z = STAGE.z + 0.004;
    const pulse = 1 + 0.04 * Math.sin(time * 6);
    this.mesh.scale.setScalar(pulse);
  }
}

// ---------------------------------------------------------------------------
// Flash
// ---------------------------------------------------------------------------

function radialTexture(inner: string, outer: string): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** A burst of warm light on the wall where a creature is born. */
export class Flash {
  readonly mesh: Mesh;
  private t = 1;
  constructor() {
    this.mesh = new Mesh(
      new PlaneGeometry(1, 1),
      new MeshBasicMaterial({
        map: radialTexture('rgba(255,236,190,1)', 'rgba(255,140,40,0)'),
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.mesh.visible = false;
    this.mesh.renderOrder = 7;
  }
  fire(at: Vector3): void {
    this.t = 0;
    this.mesh.position.set(at.x, at.y, STAGE.z + 0.006);
  }
  update(dt: number): void {
    if (this.t >= 1) {
      this.mesh.visible = false;
      return;
    }
    this.t = Math.min(1, this.t + dt / 0.7);
    this.mesh.visible = true;
    const e = 1 - Math.pow(1 - this.t, 3);
    this.mesh.scale.setScalar(0.3 + e * 1.6);
    (this.mesh.material as MeshBasicMaterial).opacity = 1 - this.t;
  }
}

// ---------------------------------------------------------------------------
// Hint pictograms: shadow-style drawings of the needed hand shape.
// ---------------------------------------------------------------------------

type Ctx = CanvasRenderingContext2D;

/** A rotated rounded bar: one finger / thumb / wrist. */
function digit(ctx: Ctx, x: number, y: number, len: number, w: number, angleDeg: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((angleDeg * Math.PI) / 180);
  ctx.beginPath();
  ctx.roundRect(0, -w / 2, len, w, w / 2);
  ctx.fill();
  ctx.restore();
}

function eye(ctx: Ctx, x: number, y: number, r: number): void {
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  ctx.ellipse(x, y, r * 1.3, r, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

const PICTOGRAMS: Record<PoseId, (ctx: Ctx) => void> = {
  // Side view, facing right: wrist, flat fingers (snout), thumb ear, pinky jaw.
  dog(ctx) {
    digit(ctx, 20, 175, 150, 70, -8); // wrist / forearm
    ctx.beginPath();
    ctx.roundRect(130, 120, 150, 70, 30); // back of hand
    ctx.fill();
    digit(ctx, 250, 140, 140, 30, 4); // index
    digit(ctx, 250, 165, 135, 30, 6); // middle
    digit(ctx, 245, 188, 120, 28, 10); // ring
    digit(ctx, 230, 200, 105, 26, 40); // pinky dropped: the jaw
    digit(ctx, 170, 135, 95, 32, -75); // thumb raised: the ear
    eye(ctx, 262, 140, 9);
  },
  // Two hands crossed at the thumbs, fingers fanned out as wings.
  bird(ctx) {
    const cx = 256;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(cx + s * 38, 170, 55, 38, s * 0.25, 0, Math.PI * 2);
      ctx.fill(); // palm
      for (let i = 0; i < 4; i++) {
        const ang = s > 0 ? -35 + i * 16 : 180 + 35 - i * 16;
        digit(ctx, cx + s * 70, 165 - i * 4, 140 - i * 14, 24, ang);
      }
      digit(ctx, cx + s * 30, 220, 110, 50, s > 0 ? 100 : 80); // wrists
    }
    digit(ctx, cx - 18, 140, 70, 26, -70); // hooked thumbs: the head
    digit(ctx, cx + 18, 140, 70, 26, -110);
    ctx.beginPath();
    ctx.arc(cx, 82, 24, 0, Math.PI * 2);
    ctx.fill();
  },
  // A fist with two raised ears.
  rabbit(ctx) {
    digit(ctx, 236, 330, 130, 70, -90); // wrist
    ctx.beginPath();
    ctx.ellipse(256, 200, 75, 65, 0, 0, Math.PI * 2);
    ctx.fill(); // fist: ring + pinky curled onto thumb
    digit(ctx, 232, 160, 145, 34, -102); // index ear
    digit(ctx, 278, 160, 145, 34, -78); // middle ear
    eye(ctx, 285, 205, 10);
  },
};

function pictogramTexture(pose: PoseId): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = 'rgba(10,5,3,0.92)';
  ctx.save();
  ctx.translate(0, 60);
  if ('filter' in ctx) ctx.filter = 'blur(3px)'; // soft shadow edge
  PICTOGRAMS[pose](ctx);
  ctx.restore();
  ctx.filter = 'none';
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

const POSE_CAPTIONS: Record<PoseId, string[]> = {
  dog: ['Make a DOG', 'flat hand · thumb up · pinky down'],
  bird: ['Make a BIRD', 'hook your thumbs · spread your fingers'],
  rabbit: ['Make a RABBIT', 'two fingers up · curl the rest'],
};

/** Shadow pictogram + short caption, shown after 8 s without success. */
export class Hint {
  readonly root = new Group();
  private readonly pics: Record<PoseId, Fader>;
  private readonly captions: Record<PoseId, Fader>;

  constructor() {
    const make = (pose: PoseId) => {
      const m = new Mesh(
        new PlaneGeometry(0.62, 0.62),
        new MeshBasicMaterial({ map: pictogramTexture(pose), transparent: true, depthWrite: false }),
      );
      m.position.set(-0.95, STAGE.titleY - 0.3, STAGE.z + 0.002);
      this.root.add(m);
      const cap = makeText(POSE_CAPTIONS[pose], 0.13, { size: 56 });
      cap.position.set(-0.95, STAGE.titleY - 0.68, STAGE.z + 0.003);
      this.root.add(cap);
      return [new Fader(m, 2), new Fader(cap, 2)] as const;
    };
    const d = make('dog');
    const b = make('bird');
    const r = make('rabbit');
    this.pics = { dog: d[0], bird: b[0], rabbit: r[0] };
    this.captions = { dog: d[1], bird: b[1], rabbit: r[1] };
  }

  show(pose: PoseId | null): void {
    for (const p of ['dog', 'bird', 'rabbit'] as PoseId[]) {
      this.pics[p].show(p === pose);
      this.captions[p].show(p === pose);
    }
  }

  update(dt: number, time: number): void {
    for (const p of ['dog', 'bird', 'rabbit'] as PoseId[]) {
      this.pics[p].update(dt);
      this.captions[p].update(dt);
      // Gentle breathing so the eye is drawn to it.
      this.pics[p].mesh.scale.setScalar(1 + 0.03 * Math.sin(time * 2.5));
    }
  }
}

// ---------------------------------------------------------------------------
// Near-field pause menu (pinch buttons)
// ---------------------------------------------------------------------------

function buttonTexture(label: string, hot: boolean): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 320;
  c.height = 320;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(160, 140, 20, 160, 160, 150);
  g.addColorStop(0, hot ? '#ffe9b8' : '#e9cf9c');
  g.addColorStop(1, hot ? '#f0a54e' : '#a8774a');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(160, 160, 150, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 10;
  ctx.strokeStyle = hot ? '#fff3d6' : '#5a3a20';
  ctx.stroke();
  ctx.fillStyle = '#2b1709';
  ctx.font = `700 58px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 160, 150);
  ctx.font = `italic 30px ${FONT}`;
  ctx.fillText('pinch', 160, 215);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

export type MenuChoice = 'resume' | 'restart';

/** Two big round buttons floating ~36 cm in front of the player. */
export class PauseMenu {
  readonly root = new Group();
  private readonly buttons: { id: MenuChoice; mesh: Mesh; normal: CanvasTexture; hot: CanvasTexture; pos: Vector3 }[] = [];
  private readonly title: Mesh;
  hovered: MenuChoice | null = null;
  private appear = 0;
  private visibleTarget = false;

  constructor() {
    this.root.position.copy(MENU.center);
    // Tilt to face the eyes (which are above and behind the menu).
    this.root.rotation.x = -0.45;
    const defs: [MenuChoice, string, number][] = [
      ['resume', 'Resume', -MENU.buttonOffsetX],
      ['restart', 'Restart', MENU.buttonOffsetX],
    ];
    for (const [id, label, x] of defs) {
      const normal = buttonTexture(label, false);
      const hot = buttonTexture(label, true);
      const mesh = new Mesh(
        new PlaneGeometry(0.17, 0.17),
        new MeshBasicMaterial({ map: normal, transparent: true, toneMapped: false }),
      );
      mesh.position.set(x, 0, 0);
      mesh.renderOrder = 10;
      this.root.add(mesh);
      this.buttons.push({ id, mesh, normal, hot, pos: new Vector3() });
    }
    this.title = makeText(['Paused'], 0.06, { size: 64 });
    this.title.position.set(0, 0.13, 0);
    this.root.add(this.title);
    this.root.visible = false;
  }

  setVisible(v: boolean): void {
    this.visibleTarget = v;
    if (v) {
      this.root.visible = true;
      this.appear = Math.min(this.appear, 0.01);
    }
  }

  get visible(): boolean {
    return this.visibleTarget;
  }

  /**
   * @param pinchPoints current pinch midpoints (room-local) of tracked hands
   * @param pinchStarted matching flags: pinch closed this frame
   * @returns the button pressed this frame, if any
   */
  update(dt: number, pinchPoints: Vector3[], pinchStarted: boolean[]): MenuChoice | null {
    this.appear = Math.max(0, Math.min(1, this.appear + (this.visibleTarget ? dt * 4 : -dt * 6)));
    this.root.visible = this.appear > 0;
    this.root.scale.setScalar(0.6 + 0.4 * this.appear);
    if (!this.visibleTarget) {
      this.hovered = null;
      return null;
    }
    this.root.updateMatrixWorld(true);
    let pressed: MenuChoice | null = null;
    this.hovered = null;
    for (const b of this.buttons) {
      // Button centre in room space (root is a child of the room).
      b.pos.copy(b.mesh.position).applyMatrix4(this.root.matrix);
      let hot = false;
      for (let i = 0; i < pinchPoints.length; i++) {
        if (pinchPoints[i].distanceTo(b.pos) < MENU.buttonRadius) {
          hot = true;
          if (pinchStarted[i] && this.appear > 0.9) pressed = b.id;
        }
      }
      if (hot) this.hovered = b.id;
      const mat = b.mesh.material as MeshBasicMaterial;
      const tex = hot ? b.hot : b.normal;
      if (mat.map !== tex) {
        mat.map = tex;
        mat.needsUpdate = true;
      }
      b.mesh.scale.setScalar(hot ? 1.12 : 1);
    }
    return pressed;
  }
}
