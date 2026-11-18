import {
  AdditiveBlending,
  BoxGeometry,
  CanvasTexture,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  Vector3,
} from '@iwsdk/core';
import type { PoseId } from '../hands/poseDetector.js';
import { glowMat, halo, Trail } from './fx.js';
import type { HandRig } from './rig.js';

export type WeaponId = 'blade' | 'firebird' | 'shield' | 'whip';

/** Every shadow becomes a weapon when you pull it into your hand. */
export const WEAPON_OF: Record<PoseId, WeaponId> = { dog: 'blade', bird: 'firebird', rabbit: 'shield', snake: 'whip' };

export const WEAPON_INFO: Record<WeaponId, { name: string; color: number; how: string }> = {
  blade: { name: 'Hound Blade', color: 0xffb347, how: 'swing it through a monster' },
  firebird: { name: 'Firebird', color: 0xff7a2a, how: 'pinch or flick your hand to throw it' },
  shield: { name: 'Moon Shield', color: 0xbfe3ff, how: 'block a shadow orb and it flies back at its caster · bash monsters' },
  whip: { name: 'Serpent Whip', color: 0x9dff7a, how: 'flick your wrist to crack it' },
};

const easeOutBack = (k: number) => {
  const c = 1.9;
  return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2);
};

const UP = new Vector3(0, 1, 0);

export abstract class Weapon {
  abstract readonly id: WeaponId;
  readonly root = new Group();
  /** 0 → 1 while it materializes out of the shadow. */
  form = 0;
  /** Seconds left of the "it just hit something" glow. */
  glow = 0;
  protected readonly q = new Quaternion();
  protected readonly tilt = new Quaternion();

  constructor(readonly hand: 'left' | 'right') {
    this.root.visible = false;
  }

  update(dt: number, t: number, rig: HandRig): void {
    this.form = Math.min(1, this.form + dt / 0.5);
    this.glow = Math.max(0, this.glow - dt);
    this.root.visible = rig.tracked;
    if (!rig.tracked) return;
    this.root.scale.setScalar(Math.max(0.001, easeOutBack(this.form)));
    this.place(dt, t, rig);
  }

  protected abstract place(dt: number, t: number, rig: HandRig): void;

  /** Tilt the held weapon forward out of the fist (sign mirrors per hand). */
  protected gripQuat(rig: HandRig, angle: number): Quaternion {
    this.tilt.setFromAxisAngle(FWD_Z, this.hand === 'right' ? angle : -angle);
    return this.q.copy(rig.quat).multiply(this.tilt);
  }

  dispose(): void {
    this.root.removeFromParent();
    this.root.traverse((o) => {
      const m = o as Mesh;
      m.geometry?.dispose();
      const mat = m.material as MeshBasicMaterial | undefined;
      if (mat && !Array.isArray(mat)) mat.dispose();
    });
  }
}
const FWD_Z = new Vector3(0, 0, 1);

// ---------------------------------------------------------------------------
// DOG → Hound Blade
// ---------------------------------------------------------------------------

export const BLADE_LEN = 0.78;

export class Blade extends Weapon {
  readonly id = 'blade';
  /** Hit segment, room space (updated every frame). */
  readonly base = new Vector3();
  readonly tip = new Vector3();
  readonly tipVel = new Vector3();
  tipSpeed = 0;
  readonly trail = new Trail(14, 0xffb347, 0.16);
  private readonly prevTip = new Vector3();
  private hasPrev = false;
  private readonly edge: MeshBasicMaterial;
  private readonly dir = new Vector3();
  private readonly steel: MeshStandardMaterial;

  constructor(hand: 'left' | 'right') {
    super(hand);
    const grip = new Mesh(new CylinderGeometry(0.016, 0.018, 0.13, 10), new MeshStandardMaterial({ color: 0x3a2414, roughness: 0.7 }));
    const gold = new MeshStandardMaterial({ color: 0xc8902e, metalness: 0.9, roughness: 0.3, emissive: 0x5a3200, emissiveIntensity: 0.6 });
    const pommel = new Mesh(new SphereGeometry(0.024, 12, 8), gold);
    pommel.position.y = -0.075;
    // Crossguard with two little hound ears.
    const guard = new Mesh(new BoxGeometry(0.17, 0.026, 0.04), gold);
    guard.position.y = 0.075;
    for (const s of [-1, 1]) {
      const ear = new Mesh(new ConeGeometry(0.018, 0.06, 6), gold);
      ear.position.set(s * 0.075, 0.1, 0);
      ear.rotation.z = -s * 0.5;
      this.root.add(ear);
    }
    this.steel = new MeshStandardMaterial({ color: 0x2a1d10, metalness: 0.95, roughness: 0.22, emissive: 0xff8a2a, emissiveIntensity: 0.55 });
    const blade = new Mesh(new BoxGeometry(0.05, BLADE_LEN - 0.08, 0.009), this.steel);
    blade.position.y = 0.09 + (BLADE_LEN - 0.08) / 2;
    const point = new Mesh(new ConeGeometry(0.0355, 0.1, 4), this.steel);
    point.rotation.y = Math.PI / 4;
    point.scale.z = 0.25;
    point.position.y = 0.09 + BLADE_LEN - 0.08 + 0.05;
    // Fiery edge glow around the blade.
    this.edge = new MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.35, blending: AdditiveBlending, depthWrite: false, fog: false });
    const edge = new Mesh(new BoxGeometry(0.075, BLADE_LEN, 0.02), this.edge);
    edge.position.y = 0.09 + BLADE_LEN / 2;
    const fuller = new Mesh(new BoxGeometry(0.012, BLADE_LEN - 0.16, 0.0105), glowMat(0xffd27a));
    fuller.position.y = 0.09 + (BLADE_LEN - 0.16) / 2 + 0.02;
    this.root.add(grip, pommel, guard, blade, point, edge, fuller);
  }

  protected place(dt: number, t: number, rig: HandRig): void {
    this.root.position.copy(rig.pos);
    this.root.quaternion.copy(this.gripQuat(rig, 0.5));
    this.dir.copy(UP).applyQuaternion(this.root.quaternion);
    this.base.copy(rig.pos).addScaledVector(this.dir, 0.1);
    this.tip.copy(rig.pos).addScaledVector(this.dir, 0.09 + BLADE_LEN * this.form);
    if (this.hasPrev && dt > 0) {
      this.tipVel.subVectors(this.tip, this.prevTip).divideScalar(dt);
      this.tipSpeed = this.tipVel.length();
    }
    this.prevTip.copy(this.tip);
    this.hasPrev = true;
    // Faster swings burn brighter; the trail only shows on a real swing.
    const heat = Math.min(1, this.tipSpeed / 5);
    this.edge.opacity = 0.25 + 0.5 * heat + this.glow * 1.5 + 0.06 * Math.sin(t * 9);
    this.steel.emissiveIntensity = 0.5 + heat * 0.8 + this.glow * 2;
    this.trail.push(this.base, this.tip, dt, heat > 0.25 ? heat : 0);
  }

  override update(dt: number, t: number, rig: HandRig): void {
    super.update(dt, t, rig);
    if (!rig.tracked) {
      this.hasPrev = false;
      this.tipSpeed = 0;
    }
    this.trail.mesh.visible = rig.tracked;
  }

  override dispose(): void {
    super.dispose();
    this.trail.mesh.removeFromParent();
    this.trail.mesh.geometry.dispose();
  }
}

// ---------------------------------------------------------------------------
// BIRD → Firebird (thrown)
// ---------------------------------------------------------------------------

/** A small bird made of fire; used perched in the hand and as the thrown shot. */
export function makeFirebird(): { root: Group; wings: Mesh[] } {
  const root = new Group();
  const fire = new MeshBasicMaterial({ color: 0xff8a2a, fog: false, toneMapped: false });
  const core = new MeshBasicMaterial({ color: 0xffe2a0, fog: false, toneMapped: false });
  const body = new Mesh(new SphereGeometry(0.03, 12, 8), fire);
  body.scale.set(1, 0.9, 1.9);
  const head = new Mesh(new SphereGeometry(0.022, 10, 8), core);
  head.position.set(0, 0.018, -0.055);
  const beak = new Mesh(new ConeGeometry(0.008, 0.03, 6), core);
  beak.rotation.x = -Math.PI / 2;
  beak.position.set(0, 0.014, -0.08);
  const tail = new Mesh(new ConeGeometry(0.03, 0.12, 6), fire);
  tail.rotation.x = Math.PI / 2;
  tail.scale.z = 0.3;
  tail.position.set(0, 0.006, 0.1);
  const wingShape = new Shape();
  wingShape.moveTo(0, 0);
  wingShape.quadraticCurveTo(0.07, 0.05, 0.14, 0.02);
  wingShape.quadraticCurveTo(0.08, -0.01, 0.1, -0.05);
  wingShape.quadraticCurveTo(0.04, -0.03, 0, -0.03);
  const wingGeo = new ShapeGeometry(wingShape);
  wingGeo.rotateX(-Math.PI / 2);
  const wingMat = new MeshBasicMaterial({ color: 0xffa040, side: DoubleSide, transparent: true, opacity: 0.9, blending: AdditiveBlending, depthWrite: false, fog: false });
  const wings: Mesh[] = [];
  for (const s of [-1, 1]) {
    const w = new Mesh(wingGeo, wingMat);
    w.scale.x = s;
    w.position.set(s * 0.012, 0.01, 0);
    wings.push(w);
  }
  root.add(body, head, beak, tail, ...wings, halo(0xff7a2a, 0.3, 0.8));
  return { root, wings };
}

export function flapWings(wings: Mesh[], t: number, speed: number): void {
  const a = Math.sin(t * speed) * 0.7;
  wings[0].rotation.z = a;
  wings[1].rotation.z = -a;
}

export class FirebirdWeapon extends Weapon {
  readonly id = 'firebird';
  private readonly bird = makeFirebird();
  /** Seconds until the next bird has formed in the hand. */
  cooldown = 0;
  private regrow = 1;
  readonly perch = new Vector3();
  private readonly fwd = new Vector3();

  constructor(hand: 'left' | 'right') {
    super(hand);
    this.bird.root.scale.setScalar(1.3);
    this.root.add(this.bird.root);
  }

  get ready(): boolean {
    return this.form >= 1 && this.cooldown <= 0;
  }

  /** The bird leaves the hand; a new one forms after the cooldown. */
  release(): void {
    this.cooldown = 0.45;
  }

  protected place(dt: number, t: number, rig: HandRig): void {
    this.cooldown = Math.max(0, this.cooldown - dt);
    // After a throw the next bird grows back out of a spark.
    this.regrow = this.cooldown > 0 ? 0 : Math.min(1, this.regrow + dt / 0.25);
    this.bird.root.scale.setScalar(Math.max(0.001, 1.3 * this.regrow));
    // Perched just above the palm, facing along the hand.
    this.perch.copy(rig.pos).addScaledVector(rig.normal, 0.07).addScaledVector(rig.side, 0.04);
    this.root.position.copy(this.perch);
    this.fwd.copy(rig.fwd);
    this.root.lookAt(this.perch.x - this.fwd.x, this.perch.y - this.fwd.y, this.perch.z - this.fwd.z);
    flapWings(this.bird.wings, t, 7);
    this.bird.root.position.y = Math.sin(t * 3.1) * 0.008;
  }
}

// ---------------------------------------------------------------------------
// RABBIT → Moon Shield
// ---------------------------------------------------------------------------

function moonFaceTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(128, 110, 10, 128, 128, 128);
  grad.addColorStop(0, '#f4fbff');
  grad.addColorStop(0.55, '#a9c8e8');
  grad.addColorStop(1, '#3d5b80');
  g.fillStyle = grad;
  g.beginPath();
  g.arc(128, 128, 126, 0, Math.PI * 2);
  g.fill();
  // Engraved ring.
  g.strokeStyle = 'rgba(30,50,80,0.6)';
  g.lineWidth = 6;
  g.beginPath();
  g.arc(128, 128, 104, 0, Math.PI * 2);
  g.stroke();
  // Crescent moon.
  g.fillStyle = 'rgba(255,240,190,0.95)';
  g.beginPath();
  g.arc(128, 128, 70, 0, Math.PI * 2);
  g.fill();
  g.globalCompositeOperation = 'destination-out';
  g.beginPath();
  g.arc(150, 112, 62, 0, Math.PI * 2);
  g.fill();
  g.globalCompositeOperation = 'source-over';
  // Rabbit silhouette sitting in the crescent.
  g.fillStyle = '#1b2840';
  g.beginPath();
  g.ellipse(132, 150, 26, 20, 0, 0, Math.PI * 2);
  g.ellipse(150, 128, 13, 12, 0, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.ellipse(146, 102, 5, 18, -0.15, 0, Math.PI * 2);
  g.ellipse(157, 104, 5, 17, 0.25, 0, Math.PI * 2);
  g.fill();
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

export const SHIELD_RADIUS = 0.21;

export class Shield extends Weapon {
  readonly id = 'shield';
  readonly center = new Vector3();
  readonly normal = new Vector3();
  readonly vel = new Vector3();
  speed = 0;
  private readonly rim: MeshBasicMaterial;
  private readonly aura: MeshBasicMaterial;
  private readonly look = new Vector3();

  constructor(hand: 'left' | 'right') {
    super(hand);
    const body = new Mesh(
      new CylinderGeometry(SHIELD_RADIUS, SHIELD_RADIUS * 0.96, 0.03, 40),
      new MeshStandardMaterial({ color: 0x5a6f8c, metalness: 0.85, roughness: 0.3, emissive: 0x24405e, emissiveIntensity: 0.5 }),
    );
    body.rotation.x = Math.PI / 2;
    const face = new Mesh(new CircleGeometry(SHIELD_RADIUS * 0.93, 40), new MeshBasicMaterial({ map: moonFaceTexture(), fog: false }));
    face.position.z = 0.016;
    this.rim = new MeshBasicMaterial({ color: 0xbfe3ff, fog: false, toneMapped: false });
    const rim = new Mesh(new TorusGeometry(SHIELD_RADIUS, 0.012, 8, 48), this.rim);
    rim.position.z = 0.008;
    this.aura = new MeshBasicMaterial({ color: 0x9fd0ff, transparent: true, opacity: 0.12, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, fog: false });
    const aura = new Mesh(new CircleGeometry(SHIELD_RADIUS * 1.35, 40), this.aura);
    aura.position.z = 0.03;
    this.root.add(body, face, rim, aura);
  }

  protected place(dt: number, t: number, rig: HandRig): void {
    // Strapped to the forearm/back of the hand, facing out of the palm... the
    // natural "guard" is the palm pushing outward, so face along the palm normal.
    this.normal.copy(rig.normal);
    this.center.copy(rig.pos).addScaledVector(this.normal, 0.07);
    this.root.position.copy(this.center);
    this.look.copy(this.center).add(this.normal);
    this.root.lookAt(this.look);
    this.vel.copy(rig.vel);
    this.speed = rig.speed;
    this.aura.opacity = 0.1 + this.glow * 0.9 + 0.04 * Math.sin(t * 4);
    this.rim.color.setHex(this.glow > 0 ? 0xffffff : 0xbfe3ff);
  }
}

// ---------------------------------------------------------------------------
// SNAKE → Serpent Whip (verlet rope)
// ---------------------------------------------------------------------------

export const WHIP_SEGMENTS = 16;
export const WHIP_SEG_LEN = 0.13;

/** Rope physics, kept free of rendering so it is unit-testable. */
export class WhipRope {
  readonly p: Vector3[] = Array.from({ length: WHIP_SEGMENTS + 1 }, () => new Vector3());
  readonly prev: Vector3[] = Array.from({ length: WHIP_SEGMENTS + 1 }, () => new Vector3());
  readonly speed = new Float32Array(WHIP_SEGMENTS + 1);
  private placed = false;
  private readonly tmp = new Vector3();
  private readonly rest = new Vector3();

  /** Root follows the hand; the rest swings, loosely pulled toward `dir`. */
  step(root: Vector3, dir: Vector3, dt: number): void {
    const n = WHIP_SEGMENTS;
    if (!this.placed) {
      for (let i = 0; i <= n; i++) {
        this.p[i].copy(root).addScaledVector(dir, i * WHIP_SEG_LEN);
        this.prev[i].copy(this.p[i]);
      }
      this.placed = true;
    }
    const h = Math.min(dt, 1 / 30);
    for (let i = 1; i <= n; i++) {
      const p = this.p[i];
      this.tmp.subVectors(p, this.prev[i]).multiplyScalar(0.985);
      this.prev[i].copy(p);
      p.add(this.tmp);
      p.y -= 3.5 * h * h;
      // Spring toward the rest line: stiff near the handle, loose at the tip.
      const k = 9 * Math.pow(1 - i / n, 1.6) + 0.6;
      this.rest.copy(root).addScaledVector(dir, i * WHIP_SEG_LEN);
      p.lerp(this.rest, Math.min(1, k * h));
    }
    this.p[0].copy(root);
    for (let it = 0; it < 6; it++) {
      for (let i = 0; i < n; i++) {
        const a = this.p[i];
        const b = this.p[i + 1];
        this.tmp.subVectors(b, a);
        const d = this.tmp.length() || 1e-6;
        const diff = (d - WHIP_SEG_LEN) / d;
        if (i === 0) b.addScaledVector(this.tmp, -diff);
        else {
          a.addScaledVector(this.tmp, diff * 0.5);
          b.addScaledVector(this.tmp, -diff * 0.5);
        }
      }
    }
    for (let i = 0; i <= n; i++) this.speed[i] = dt > 0 ? this.p[i].distanceTo(this.prev[i]) / h : 0;
  }

  reset(): void {
    this.placed = false;
  }
}

export class Whip extends Weapon {
  readonly id = 'whip';
  readonly rope = new WhipRope();
  readonly trail = new Trail(12, 0x9dff7a, 0.12);
  private readonly links: InstancedMesh;
  private readonly head = new Group();
  private readonly handle: Mesh;
  private readonly rootPt = new Vector3();
  private readonly dir = new Vector3();
  private readonly m = new Matrix4();
  private readonly mq = new Quaternion();
  private readonly ms = new Vector3();
  private readonly mid = new Vector3();
  private readonly seg = new Vector3();
  private readonly tipBack = new Vector3();
  private readonly scaleMat: MeshStandardMaterial;

  get tipSpeed(): number {
    return this.rope.speed[WHIP_SEGMENTS];
  }

  constructor(hand: 'left' | 'right') {
    super(hand);
    this.handle = new Mesh(new CylinderGeometry(0.017, 0.02, 0.17, 10), new MeshStandardMaterial({ color: 0x24402a, roughness: 0.6, metalness: 0.3 }));
    this.root.add(this.handle);
    this.scaleMat = new MeshStandardMaterial({ color: 0x1f5a2a, roughness: 0.4, metalness: 0.5, emissive: 0x58ff6a, emissiveIntensity: 0.45 });
    this.links = new InstancedMesh(new CylinderGeometry(1, 1, 1, 8), this.scaleMat, WHIP_SEGMENTS);
    this.links.frustumCulled = false;
    const headMat = new MeshStandardMaterial({ color: 0x2c7a34, roughness: 0.35, metalness: 0.4, emissive: 0x3aff5a, emissiveIntensity: 0.5 });
    const skull = new Mesh(new SphereGeometry(0.03, 12, 8), headMat);
    skull.scale.set(1, 0.7, 1.6);
    for (const s of [-1, 1]) {
      const eye = new Mesh(new SphereGeometry(0.007, 6, 6), glowMat(0xffe066));
      eye.position.set(s * 0.018, 0.012, -0.02);
      this.head.add(eye);
    }
    const tongue = new Mesh(new ConeGeometry(0.004, 0.05, 4), glowMat(0xff3a5a));
    tongue.rotation.x = -Math.PI / 2;
    tongue.position.z = -0.065;
    this.head.add(skull, tongue, halo(0x9dff7a, 0.16, 0.6));
  }

  /** Links and head live in room space (not under the hand). */
  attach(parent: Group): void {
    parent.add(this.links, this.head, this.trail.mesh);
  }

  protected place(dt: number, t: number, rig: HandRig): void {
    const q = this.gripQuat(rig, 0.55);
    this.root.position.copy(rig.pos);
    this.root.quaternion.copy(q);
    this.dir.copy(UP).applyQuaternion(q);
    this.handle.position.y = 0.04;
    this.rootPt.copy(rig.pos).addScaledVector(this.dir, 0.12);
    this.rope.step(this.rootPt, this.dir, dt);
    const p = this.rope.p;
    const form = this.form;
    for (let i = 0; i < WHIP_SEGMENTS; i++) {
      this.mid.addVectors(p[i], p[i + 1]).multiplyScalar(0.5);
      this.seg.subVectors(p[i + 1], p[i]);
      const len = this.seg.length() || 1e-4;
      this.mq.setFromUnitVectors(UP, this.seg.divideScalar(len));
      const r = (0.016 - 0.011 * (i / WHIP_SEGMENTS)) * form;
      this.ms.set(r, len * form, r);
      this.m.compose(this.mid, this.mq, this.ms);
      this.links.setMatrixAt(i, this.m);
    }
    this.links.instanceMatrix.needsUpdate = true;
    const tip = p[WHIP_SEGMENTS];
    this.head.position.copy(tip);
    this.tipBack.subVectors(tip, p[WHIP_SEGMENTS - 1]);
    this.head.lookAt(this.tipBack.add(tip));
    this.head.rotateY(Math.PI);
    this.head.scale.setScalar(Math.max(0.001, form));
    const heat = Math.min(1, this.tipSpeed / 9);
    this.scaleMat.emissiveIntensity = 0.4 + heat + this.glow * 2;
    this.trail.push(p[WHIP_SEGMENTS - 3], tip, dt, heat > 0.3 ? heat : 0);
  }

  override update(dt: number, t: number, rig: HandRig): void {
    super.update(dt, t, rig);
    this.links.visible = this.head.visible = this.trail.mesh.visible = rig.tracked;
    if (!rig.tracked) this.rope.reset();
  }

  override dispose(): void {
    super.dispose();
    for (const o of [this.links, this.head, this.trail.mesh]) {
      o.removeFromParent();
    }
    this.links.geometry.dispose();
    this.trail.mesh.geometry.dispose();
  }
}

export function makeWeapon(id: WeaponId, hand: 'left' | 'right'): Weapon {
  if (id === 'blade') return new Blade(hand);
  if (id === 'firebird') return new FirebirdWeapon(hand);
  if (id === 'shield') return new Shield(hand);
  return new Whip(hand);
}
