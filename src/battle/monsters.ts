import {
  AdditiveBlending,
  BoxGeometry,
  CanvasTexture,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  Vector3,
  type Sprite,
} from '@iwsdk/core';
import { glowMat, halo, mergeStatic, rimMaterial, type Sparks } from './fx.js';

export type MonsterKind = 'imp' | 'wraith' | 'brute' | 'boss';

type RimMat = ReturnType<typeof rimMaterial>;

/** What a monster can do to the arena (implemented by Battle). */
export interface ArenaCtx {
  /** Player's head, room space. */
  readonly head: Vector3;
  readonly sparks: Sparks;
  /** Launch a shadow orb from `from` toward the player. */
  fireOrb(from: Vector3, speed: number, big: boolean, owner: Monster): void;
  /** A melee blow lands from `from`: returns true if the shield blocked it. */
  strike(from: Vector3, dmg: number): boolean;
  /** Boss only: bring in reinforcements. */
  summon(kind: MonsterKind, count: number): void;
  sound(kind: 'screech' | 'growl' | 'stomp' | 'cast' | 'slam' | 'roar' | 'whoosh'): void;
}

/** A hittable sphere. Normal monsters have one; the boss has three cores. */
export interface Target {
  readonly center: Vector3;
  radius: number;
  alive: boolean;
  hp: number;
  readonly maxHp: number;
  readonly owner: Monster;
  /** Per-target hit cooldown so one swing hits once. */
  cooldown: number;
}

const tmp = new Vector3();
const tmp2 = new Vector3();

function cyl(r0: number, r1: number, h: number, mat: MeshStandardMaterial | MeshBasicMaterial, seg = 8): Mesh {
  const g = new CylinderGeometry(r0, r1, h, seg);
  g.translate(0, -h / 2, 0); // hangs down from its pivot
  return new Mesh(g, mat);
}

function pivotAt(x: number, y: number, z: number, ...children: Object3D[]): Group {
  const g = new Group();
  g.position.set(x, y, z);
  if (children.length) g.add(...children);
  return g;
}

export abstract class Monster {
  abstract readonly kind: MonsterKind;
  readonly root = new Group();
  /** Animated body (offset from root for lunges, bobs). */
  readonly model = new Group();
  readonly targets: Target[] = [];
  state = 'emerge';
  stateT = 0;
  /** Spawn grows the monster out of its rift. */
  emerge = 0;
  dying = false;
  /** Fully gone: Battle removes it. */
  dead = false;
  /** Battle has scored this defeat. */
  counted = false;
  /** Horizontal knockback velocity. */
  readonly knock = new Vector3();
  /** Direction (yaw) of this monster's slot around the player. */
  slotAngle = 0;
  protected readonly mats: RimMat[] = [];
  protected flash = 0;
  protected eyes: Sprite[] = [];
  private shards: { o: Object3D; v: Vector3; s: Vector3 }[] = [];
  private deathT = 0;
  /** Score for killing it. */
  abstract readonly points: number;

  constructor() {
    this.root.add(this.model);
  }

  protected target(radius: number, hp: number): Target {
    const t: Target = { center: new Vector3(), radius, alive: true, hp, maxHp: hp, owner: this, cooldown: 0 };
    this.targets.push(t);
    return t;
  }

  private readonly glows = new Map<number, MeshBasicMaterial>();
  /** One glowing material per colour per monster (so its pieces can merge). */
  protected glow(color: number): MeshBasicMaterial {
    let m = this.glows.get(color);
    if (!m) {
      m = glowMat(color);
      this.glows.set(color, m);
    }
    return m;
  }

  /** Merge the static pieces of the finished model; `keep` lists parts animated on their own. */
  protected bake(...keep: Object3D[]): void {
    mergeStatic(this.model, new Set(keep));
  }

  protected rim(color: number, emissive: number, rim: number, metal = 0.2): RimMat {
    const m = rimMaterial({ color, roughness: 0.55, metalness: metal, emissive, emissiveIntensity: 0.6 }, rim);
    this.mats.push(m);
    return m;
  }

  get alive(): boolean {
    return !this.dying && !this.dead;
  }

  /** Damage one of this monster's targets. Returns true if it died. */
  hit(t: Target, dmg: number, dir: Vector3): boolean {
    if (!this.alive || !t.alive) return false;
    t.hp -= dmg;
    t.cooldown = 0.3;
    this.flash = 1;
    this.onHit(dmg, dir);
    if (t.hp <= 0) {
      t.alive = false;
      if (this.targets.every((x) => !x.alive)) {
        this.die(dir);
        return true;
      }
    }
    return false;
  }

  protected onHit(dmg: number, dir: Vector3): void {
    this.knock.x += dir.x * 2.2 * Math.min(2, dmg);
    this.knock.z += dir.z * 2.2 * Math.min(2, dmg);
  }

  /** Burst into shadow shards. */
  die(dir: Vector3): void {
    if (this.dying) return;
    this.dying = true;
    this.deathT = 0;
    for (const t of this.targets) t.alive = false;
    this.model.traverse((o) => {
      if (o === this.model || !(o as Mesh).isMesh) return;
      const v = new Vector3(Math.random() - 0.5, Math.random() * 0.9 + 0.3, Math.random() - 0.5).multiplyScalar(2.6);
      v.addScaledVector(dir, 1.6);
      this.shards.push({ o, v, s: new Vector3((Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9) });
    });
  }

  update(dt: number, t: number, ctx: ArenaCtx): void {
    for (const tg of this.targets) tg.cooldown = Math.max(0, tg.cooldown - dt);
    this.flash = Math.max(0, this.flash - dt * 5);
    for (const m of this.mats) m.flash.value = this.flash * 1.6;
    if (this.dying) {
      this.deathT += dt;
      const k = Math.max(0, 1 - this.deathT / 1.1);
      for (const s of this.shards) {
        s.v.y -= 6 * dt;
        s.o.position.addScaledVector(s.v, dt * 0.6);
        s.o.rotation.x += s.s.x * dt;
        s.o.rotation.y += s.s.y * dt;
        s.o.scale.multiplyScalar(Math.max(0.2, 1 - dt * 2.2));
      }
      for (const e of this.eyes) e.material.opacity = k;
      if (this.deathT > 1.1) {
        this.dead = true;
        this.root.visible = false;
      }
      return;
    }
    // Knockback slides along the ground and decays.
    this.root.position.addScaledVector(this.knock, dt);
    this.knock.multiplyScalar(Math.max(0, 1 - dt * 5));
    if (this.emerge < 1) {
      this.emerge = Math.min(1, this.emerge + dt / 0.9);
      const e = this.emerge;
      this.root.scale.setScalar(Math.max(0.01, e));
    }
    this.think(dt, t, ctx);
    this.syncTargets();
  }

  protected abstract think(dt: number, t: number, ctx: ArenaCtx): void;
  protected abstract syncTargets(): void;

  protected setState(s: string): void {
    this.state = s;
    this.stateT = 0;
  }

  /** Turn to face the player (yaw only). */
  protected face(head: Vector3, rate: number, dt: number): void {
    const want = Math.atan2(head.x - this.root.position.x, head.z - this.root.position.z);
    let d = want - this.root.rotation.y;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.root.rotation.y += d * Math.min(1, rate * dt);
  }

  /** Horizontal distance to the player. */
  protected flatDist(head: Vector3): number {
    return Math.hypot(head.x - this.root.position.x, head.z - this.root.position.z);
  }

  /** Move toward this monster's slot, `stop` metres from the player. */
  protected approach(head: Vector3, stop: number, speed: number, dt: number): boolean {
    const gx = head.x + Math.sin(this.slotAngle) * stop;
    const gz = head.z - Math.cos(this.slotAngle) * stop;
    tmp.set(gx - this.root.position.x, 0, gz - this.root.position.z);
    const d = tmp.length();
    if (d < 0.05) return true;
    this.root.position.addScaledVector(tmp.divideScalar(d), Math.min(d, speed * dt));
    return d < 0.12;
  }

  dispose(): void {
    this.root.removeFromParent();
    this.root.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        (m.material as MeshBasicMaterial).dispose?.();
      }
    });
    for (const m of this.mats) m.dispose();
    for (const m of this.glows.values()) m.dispose();
  }
}

// ---------------------------------------------------------------------------
// Shadow Imp — fast melee crawler
// ---------------------------------------------------------------------------

export class Imp extends Monster {
  readonly kind = 'imp';
  readonly points = 100;
  private readonly body: Group;
  private readonly armL: Group;
  private readonly armR: Group;
  private readonly legL: Group;
  private readonly legR: Group;
  private readonly head: Group;
  private readonly tail: Group;
  private readonly core: Target;
  private phase = Math.random() * 6;
  private readonly speed = 1.5 + Math.random() * 0.4;

  constructor() {
    super();
    const skin = this.rim(0x150b26, 0x12051f, 0x9a5cff);
    const dark = this.rim(0x0a0612, 0x080210, 0x7a3cff);
    // Torso, hunched forward.
    this.body = pivotAt(0, 0.5, 0);
    const torso = new Mesh(new SphereGeometry(0.17, 14, 10), skin);
    torso.scale.set(1, 1.15, 0.85);
    torso.position.set(0, 0.16, 0.02);
    const belly = new Mesh(new TorusGeometry(0.06, 0.012, 6, 16), this.glow(0xc06bff));
    belly.position.set(0, 0.12, 0.15);
    this.head = pivotAt(0, 0.38, 0.08);
    const skull = new Mesh(new SphereGeometry(0.11, 14, 10), skin);
    skull.scale.set(1, 0.9, 1.1);
    const jaw = new Mesh(new BoxGeometry(0.13, 0.03, 0.08), dark);
    jaw.position.set(0, -0.06, 0.06);
    const mouth = new Mesh(new BoxGeometry(0.09, 0.012, 0.01), this.glow(0xff6ad5));
    mouth.position.set(0, -0.035, 0.105);
    this.head.add(skull, jaw, mouth);
    for (const s of [-1, 1]) {
      const horn = new Mesh(new ConeGeometry(0.025, 0.14, 6), dark);
      horn.position.set(s * 0.07, 0.09, -0.02);
      horn.rotation.set(-0.5, 0, -s * 0.5);
      const eye = new Mesh(new SphereGeometry(0.018, 8, 6), this.glow(0xf0a0ff));
      eye.position.set(s * 0.045, 0.01, 0.095);
      const glow = halo(0xc35cff, 0.12, 0.9);
      glow.position.copy(eye.position);
      this.eyes.push(glow);
      this.head.add(horn, eye, glow);
    }
    this.body.add(torso, belly, this.head);
    // Long arms with claws.
    const arm = (s: number) => {
      const shoulder = pivotAt(s * 0.17, 0.25, 0.03);
      const upper = cyl(0.035, 0.028, 0.24, skin);
      const elbow = pivotAt(0, -0.24, 0);
      elbow.rotation.x = -0.6;
      const fore = cyl(0.028, 0.02, 0.22, skin);
      const hand = pivotAt(0, -0.22, 0);
      for (let c = -1; c <= 1; c++) {
        const claw = new Mesh(new ConeGeometry(0.009, 0.08, 5), this.glow(0xe6c8ff));
        claw.position.set(c * 0.016, -0.04, 0.01);
        claw.rotation.x = Math.PI + 0.3;
        hand.add(claw);
      }
      elbow.add(fore, hand);
      shoulder.add(upper, elbow);
      this.body.add(shoulder);
      return shoulder;
    };
    this.armL = arm(-1);
    this.armR = arm(1);
    const leg = (s: number) => {
      const hip = pivotAt(s * 0.09, 0.5, 0);
      const thigh = cyl(0.045, 0.035, 0.26, skin);
      const knee = pivotAt(0, -0.26, 0);
      knee.rotation.x = 0.35;
      const shin = cyl(0.033, 0.024, 0.24, skin);
      const foot = new Mesh(new BoxGeometry(0.06, 0.03, 0.12), dark);
      foot.position.set(0, -0.25, 0.03);
      knee.add(shin, foot);
      hip.add(thigh, knee);
      this.model.add(hip);
      return hip;
    };
    this.legL = leg(-1);
    this.legR = leg(1);
    this.tail = pivotAt(0, 0.08, -0.13);
    const tail = cyl(0.025, 0.006, 0.4, dark);
    tail.rotation.x = 0;
    this.tail.add(tail);
    this.tail.rotation.x = -2.2;
    this.body.add(this.tail);
    this.model.add(this.body);
    this.core = this.target(0.36, 2);
    this.bake();
  }

  protected syncTargets(): void {
    this.core.center.set(0, 0.68 * this.root.scale.y, 0).add(this.root.position);
    this.core.center.y += this.model.position.y;
    tmp2.set(0, 0, this.model.position.z).applyAxisAngle(UP, this.root.rotation.y);
    this.core.center.add(tmp2);
  }

  protected override onHit(dmg: number, dir: Vector3): void {
    super.onHit(dmg, dir);
    if (this.state === 'windup' || this.state === 'strike' || this.state === 'advance') this.setState('stagger');
  }

  protected think(dt: number, t: number, ctx: ArenaCtx): void {
    this.stateT += dt;
    const head = ctx.head;
    this.face(head, 8, dt);
    let run = 0;
    let raise = 0;
    let lunge = 0;
    switch (this.state) {
      case 'emerge':
        if (this.emerge >= 1) {
          this.setState('advance');
          ctx.sound('screech');
        }
        break;
      case 'advance':
        run = 1;
        if (this.approach(head, 1.05, this.speed, dt)) this.setState('windup');
        break;
      case 'windup': {
        // Rear up, claws high, eyes flare: the moment to strike it.
        raise = Math.min(1, this.stateT / 0.35);
        if (this.stateT > 1.15) this.setState('strike');
        break;
      }
      case 'strike': {
        const k = Math.min(1, this.stateT / 0.18);
        lunge = Math.sin(k * Math.PI) * 0.3;
        raise = 1 - k;
        if (this.stateT >= 0.18 && this.stateT - dt < 0.18) {
          tmp.copy(this.core.center);
          const blocked = ctx.strike(tmp, 1);
          if (blocked) this.knock.set(Math.sin(this.slotAngle), 0, -Math.cos(this.slotAngle)).multiplyScalar(4);
        }
        if (this.stateT > 0.3) this.setState('recover');
        break;
      }
      case 'recover':
        // Skitter back, then come again.
        this.approach(head, 2.0, 1.6, dt);
        run = 0.7;
        if (this.stateT > 1.8) this.setState('advance');
        break;
      case 'stagger':
        raise = 0;
        if (this.stateT > 0.55) this.setState('recover');
        break;
    }
    this.phase += dt * (run > 0 ? 11 : 3);
    const swing = Math.sin(this.phase) * 0.8 * run;
    this.legL.rotation.x = swing;
    this.legR.rotation.x = -swing;
    this.armL.rotation.x = -swing * 0.8 - raise * 2.6;
    this.armR.rotation.x = swing * 0.8 - raise * 2.6;
    this.armL.rotation.z = -raise * 0.4;
    this.armR.rotation.z = raise * 0.4;
    this.body.rotation.x = 0.55 - raise * 0.75 + (this.state === 'stagger' ? -0.5 * Math.sin(Math.min(1, this.stateT * 4) * Math.PI) : 0);
    this.model.position.y = Math.abs(Math.sin(this.phase)) * 0.05 * run;
    this.model.position.z = lunge;
    this.head.rotation.x = -0.4 + raise * 0.3;
    this.tail.rotation.z = Math.sin(t * 5 + this.phase) * 0.4;
    for (const e of this.eyes) e.scale.setScalar(0.12 + raise * 0.12 + 0.02 * Math.sin(t * 13));
  }
}

const UP = new Vector3(0, 1, 0);

// ---------------------------------------------------------------------------
// Wraith — floating caster that throws shadow orbs
// ---------------------------------------------------------------------------

export class Wraith extends Monster {
  readonly kind = 'wraith';
  readonly points = 150;
  private readonly core: Target;
  private readonly ribbons: Mesh[] = [];
  private readonly handL: Group;
  private readonly handR: Group;
  private readonly orb: Mesh;
  private readonly orbGlow: Sprite;
  private readonly home = new Vector3();
  private castIn = 2 + Math.random() * 1.5;
  private casts = 0;
  private wander = Math.random() * 10;
  private readonly height = 1.7 + Math.random() * 0.6;

  constructor(private readonly dist = 4 + Math.random() * 1.5) {
    super();
    const cloth = this.rim(0x0d0a1e, 0x0a0618, 0x6f7dff, 0.1);
    (cloth as MeshStandardMaterial).side = DoubleSide;
    const hood = new Mesh(new ConeGeometry(0.2, 0.42, 16, 1, true), cloth);
    hood.position.y = 0.1;
    const face = new Mesh(new SphereGeometry(0.12, 12, 8), new MeshBasicMaterial({ color: 0x000000 }));
    face.position.set(0, -0.02, 0.06);
    const robe = new Mesh(new ConeGeometry(0.3, 0.95, 18, 1, true), cloth);
    robe.position.y = -0.5;
    for (const s of [-1, 1]) {
      const eye = new Mesh(new SphereGeometry(0.016, 8, 6), this.glow(0xb8c4ff));
      eye.position.set(s * 0.045, -0.01, 0.16);
      const glow = halo(0x7d8cff, 0.14, 1);
      glow.position.copy(eye.position);
      this.eyes.push(glow);
      this.model.add(eye, glow);
    }
    // Tattered ribbons trailing below the robe.
    const ribbonMat = new MeshBasicMaterial({ color: 0x14102a, side: DoubleSide, transparent: true, opacity: 0.85 });
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const g = new PlaneGeometry(0.07, 0.5);
      g.translate(0, -0.25, 0);
      const r = new Mesh(g, ribbonMat);
      r.position.set(Math.sin(a) * 0.24, -0.9, Math.cos(a) * 0.24);
      r.rotation.y = a;
      this.ribbons.push(r);
      this.model.add(r);
    }
    const handMat = this.rim(0x1a1530, 0x221a55, 0x9fb0ff);
    const mkHand = (s: number) => {
      const h = pivotAt(s * 0.32, -0.3, 0.18);
      for (let c = -1; c <= 1; c++) {
        const f = new Mesh(new ConeGeometry(0.012, 0.11, 5), handMat);
        f.position.set(c * 0.018, -0.03, 0);
        f.rotation.x = 0.4;
        h.add(f);
      }
      this.model.add(h);
      return h;
    };
    this.handL = mkHand(-1);
    this.handR = mkHand(1);
    this.orb = new Mesh(new SphereGeometry(0.06, 12, 8), this.glow(0xe2d4ff));
    this.orbGlow = halo(0x8c6bff, 0.4, 0.9);
    this.orb.add(this.orbGlow);
    this.orb.position.set(0, -0.28, 0.32);
    this.model.add(hood, face, robe, this.orb);
    this.model.scale.setScalar(1.45);
    this.core = this.target(0.42, 2);
    this.bake(...this.ribbons, this.orb);
  }

  protected syncTargets(): void {
    this.core.center.copy(this.root.position);
    this.core.center.y += this.model.position.y - 0.25;
  }

  protected think(dt: number, t: number, ctx: ArenaCtx): void {
    this.stateT += dt;
    const head = ctx.head;
    this.face(head, 4, dt);
    this.wander += dt;
    // Drift around a home point on an arc in front of the player; every few
    // casts it swoops in close to rake with its claws (so blades can reach it).
    const swooping = this.state === 'swoop' || this.state === 'rake';
    const a = swooping ? this.slotAngle * 0.6 : this.slotAngle + Math.sin(this.wander * 0.35) * 0.35;
    const dist = swooping ? 1.05 : this.dist;
    const y = swooping ? 1.55 : this.height + Math.sin(this.wander * 0.8) * 0.25;
    this.home.set(head.x + Math.sin(a) * dist, y, head.z - Math.cos(a) * dist);
    tmp.subVectors(this.home, this.root.position);
    this.root.position.addScaledVector(tmp, Math.min(1, dt * (swooping ? 2.4 : 1.2)));
    let charge = 0;
    if (this.state === 'emerge') {
      if (this.emerge >= 1) this.setState('hover');
    } else if (this.state === 'hover') {
      this.castIn -= dt;
      if (this.castIn <= 0) {
        if (this.casts >= 2) {
          this.casts = 0;
          this.setState('swoop');
          ctx.sound('screech');
        } else {
          this.setState('cast');
          ctx.sound('cast');
        }
      }
    } else if (this.state === 'swoop') {
      if (this.stateT > 1.4) this.setState('rake');
    } else if (this.state === 'rake') {
      charge = Math.min(1, this.stateT / 1.1) * 0.4;
      if (this.stateT >= 1.2 && this.stateT - dt < 1.2) {
        tmp.copy(this.core.center);
        ctx.strike(tmp, 1);
      }
      if (this.stateT > 1.6) {
        this.castIn = 2 + Math.random();
        this.setState('hover');
      }
    } else if (this.state === 'cast') {
      charge = Math.min(1, this.stateT / 0.9);
      if (this.stateT >= 0.9) {
        this.orb.getWorldPosition(tmp);
        // Orb positions are room space: the battle root sits at the room origin.
        this.root.parent?.worldToLocal(tmp);
        ctx.fireOrb(tmp, 2.6, false, this);
        this.casts++;
        this.castIn = 2.6 + Math.random() * 1.6;
        this.setState('hover');
      }
    } else if (this.state === 'stagger') {
      if (this.stateT > 0.5) {
        this.castIn = Math.max(this.castIn, 1.2);
        this.setState('hover');
      }
    }
    this.model.position.y = Math.sin(t * 1.7 + this.wander) * 0.06;
    for (let i = 0; i < this.ribbons.length; i++) {
      const r = this.ribbons[i];
      r.rotation.x = Math.sin(t * 3 + i * 1.3) * 0.35 - 0.15;
      r.rotation.z = Math.cos(t * 2.3 + i) * 0.2;
    }
    const lift = charge;
    this.handL.position.set(-0.32 + lift * 0.2, -0.3 + lift * 0.05, 0.18 + lift * 0.1);
    this.handR.position.set(0.32 - lift * 0.2, -0.3 + lift * 0.05, 0.18 + lift * 0.1);
    this.orb.scale.setScalar(Math.max(0.001, charge * (1 + 0.1 * Math.sin(t * 20))));
    this.orb.visible = charge > 0.02 && this.state === 'cast';
    for (const e of this.eyes) e.scale.setScalar(0.14 + charge * 0.1);
  }

  protected override onHit(dmg: number, dir: Vector3): void {
    this.knock.x += dir.x * 1.2;
    this.knock.z += dir.z * 1.2;
    this.setState('stagger');
    void dmg;
  }
}

// ---------------------------------------------------------------------------
// Iron Brute — slow, armoured, hits hard
// ---------------------------------------------------------------------------

export class Brute extends Monster {
  readonly kind = 'brute';
  readonly points = 300;
  private readonly core: Target;
  private readonly body: Group;
  private readonly armR: Group;
  private readonly armL: Group;
  private readonly legL: Group;
  private readonly legR: Group;
  private readonly heart: Mesh;
  private phase = 0;
  private stepSide = 0;
  private stagger = 0;

  constructor() {
    super();
    const skin = this.rim(0x120c1c, 0x0e0618, 0x8d4dff);
    const iron = this.rim(0x2a2838, 0x10081c, 0x6a5aff, 0.85);
    this.body = pivotAt(0, 1.0, 0);
    const torso = new Mesh(new SphereGeometry(0.36, 16, 12), skin);
    torso.scale.set(1.15, 1.1, 0.8);
    torso.position.y = 0.32;
    const chest = new Mesh(new BoxGeometry(0.62, 0.36, 0.12), iron);
    chest.position.set(0, 0.42, 0.25);
    this.heart = new Mesh(new SphereGeometry(0.075, 12, 8), this.glow(0xd38bff));
    this.heart.position.set(0, 0.4, 0.33);
    const heartGlow = halo(0xa64dff, 0.45, 0.9);
    this.heart.add(heartGlow);
    const head = new Mesh(new SphereGeometry(0.13, 12, 10), skin);
    head.position.set(0, 0.78, 0.12);
    const helm = new Mesh(new CylinderGeometry(0.15, 0.17, 0.14, 12), iron);
    helm.position.set(0, 0.84, 0.12);
    for (const s of [-1, 1]) {
      const horn = new Mesh(new ConeGeometry(0.045, 0.32, 8), iron);
      horn.position.set(s * 0.17, 0.95, 0.1);
      horn.rotation.z = -s * 0.9;
      const eye = new Mesh(new SphereGeometry(0.02, 8, 6), this.glow(0xffb0ff));
      eye.position.set(s * 0.05, 0.78, 0.24);
      const glow = halo(0xd05cff, 0.14, 1);
      glow.position.copy(eye.position);
      this.eyes.push(glow);
      const pad = new Mesh(new SphereGeometry(0.16, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), iron);
      pad.position.set(s * 0.42, 0.55, 0);
      this.body.add(horn, eye, glow, pad);
    }
    this.body.add(torso, chest, this.heart, head, helm);
    const arm = (s: number, club: boolean) => {
      const shoulder = pivotAt(s * 0.45, 0.55, 0);
      const upper = cyl(0.09, 0.075, 0.42, skin);
      const elbow = pivotAt(0, -0.42, 0);
      elbow.rotation.x = -0.3;
      const fore = cyl(0.08, 0.1, 0.38, skin);
      const fist = new Mesh(new SphereGeometry(0.11, 10, 8), skin);
      fist.position.y = -0.42;
      elbow.add(fore, fist);
      if (club) {
        const mace = pivotAt(0, -0.42, 0);
        const shaft = new Mesh(new CylinderGeometry(0.035, 0.05, 0.85, 8), iron);
        shaft.position.set(0, 0, 0.36);
        shaft.rotation.x = Math.PI / 2;
        const headM = new Mesh(new SphereGeometry(0.15, 12, 10), iron);
        headM.position.set(0, 0, 0.8);
        for (let i = 0; i < 6; i++) {
          const spike = new Mesh(new ConeGeometry(0.035, 0.14, 6), this.glow(0xb98cff));
          const a = (i / 6) * Math.PI * 2;
          spike.position.set(Math.cos(a) * 0.15, Math.sin(a) * 0.15, 0.8);
          spike.rotation.z = a - Math.PI / 2;
          mace.add(spike);
        }
        mace.add(shaft, headM);
        elbow.add(mace);
      }
      shoulder.add(upper, elbow);
      this.body.add(shoulder);
      return shoulder;
    };
    this.armL = arm(-1, false);
    this.armR = arm(1, true);
    const leg = (s: number) => {
      const hip = pivotAt(s * 0.22, 1.0, 0);
      const thigh = cyl(0.12, 0.1, 0.5, skin);
      const knee = pivotAt(0, -0.5, 0);
      const shin = cyl(0.1, 0.12, 0.46, iron);
      const foot = new Mesh(new BoxGeometry(0.2, 0.08, 0.3), iron);
      foot.position.set(0, -0.48, 0.05);
      knee.add(shin, foot);
      hip.add(thigh, knee);
      this.model.add(hip);
      return hip;
    };
    this.legL = leg(-1);
    this.legR = leg(1);
    this.model.add(this.body);
    this.core = this.target(0.48, 7);
    this.bake(this.heart);
  }

  protected syncTargets(): void {
    this.core.center.copy(this.root.position);
    this.core.center.y += 1.35 * this.root.scale.y;
  }

  protected override onHit(dmg: number, dir: Vector3): void {
    // Armoured: only heavy blows knock it back or break its swing.
    this.knock.x += dir.x * 0.6 * dmg;
    this.knock.z += dir.z * 0.6 * dmg;
    this.stagger += dmg;
    if (this.stagger >= 2.5 && (this.state === 'windup' || this.state === 'advance')) {
      this.stagger = 0;
      this.setState('stagger');
    }
  }

  protected think(dt: number, t: number, ctx: ArenaCtx): void {
    this.stateT += dt;
    const head = ctx.head;
    this.face(head, 2.5, dt);
    this.stagger = Math.max(0, this.stagger - dt * 0.6);
    let walk = 0;
    let raise = 0;
    switch (this.state) {
      case 'emerge':
        if (this.emerge >= 1) {
          this.setState('advance');
          ctx.sound('growl');
        }
        break;
      case 'advance':
        walk = 1;
        if (this.approach(head, 1.35, 0.75, dt)) this.setState('windup');
        break;
      case 'windup':
        raise = Math.min(1, this.stateT / 0.9);
        if (this.stateT > 1.4) this.setState('slam');
        break;
      case 'slam': {
        const k = Math.min(1, this.stateT / 0.16);
        raise = 1 - k * 1.3;
        if (this.stateT >= 0.16 && this.stateT - dt < 0.16) {
          ctx.sound('slam');
          tmp.copy(this.core.center);
          if (ctx.strike(tmp, 2)) {
            this.setState('stagger');
            this.knock.set(Math.sin(this.slotAngle), 0, -Math.cos(this.slotAngle)).multiplyScalar(2);
            break;
          }
        }
        if (this.stateT > 1.0) this.setState('recover');
        break;
      }
      case 'recover':
        walk = 0.6;
        this.approach(head, 2.0, 0.8, dt);
        if (this.stateT > 1.4) this.setState('advance');
        break;
      case 'stagger':
        if (this.stateT > 1.0) this.setState('recover');
        break;
    }
    const before = Math.sin(this.phase);
    this.phase += dt * (walk > 0 ? 4.2 : 1);
    const after = Math.sin(this.phase);
    if (walk > 0 && Math.sign(before) !== Math.sign(after)) {
      this.stepSide++;
      ctx.sound('stomp');
    }
    const swing = after * 0.45 * walk;
    this.legL.rotation.x = swing;
    this.legR.rotation.x = -swing;
    this.armL.rotation.x = -swing * 0.7;
    this.armR.rotation.x = swing * 0.5 - Math.max(0, raise) * 2.9 + Math.min(0, raise) * -0.6;
    this.body.rotation.x = 0.12 - Math.max(0, raise) * 0.3 + Math.max(0, -raise) * 0.5 + (this.state === 'stagger' ? -0.35 : 0);
    this.body.rotation.z = Math.sin(this.phase) * 0.05 * walk;
    this.model.position.y = -Math.abs(after) * 0.04 * walk;
    this.heart.scale.setScalar(1 + 0.25 * Math.sin(t * 6));
    for (const e of this.eyes) e.scale.setScalar(0.14 + Math.max(0, raise) * 0.12);
  }
}

// ---------------------------------------------------------------------------
// The Shadow Eater — the final boss, with three glowing cores
// ---------------------------------------------------------------------------

export class ShadowEater extends Monster {
  readonly kind = 'boss';
  readonly points = 3000;
  readonly chest: Target;
  readonly hands: Target[];
  private readonly arms: Group[] = [];
  private readonly palms: Group[] = [];
  private readonly uppers: Mesh[] = [];
  private readonly coreMeshes: Mesh[] = [];
  private readonly headG: Group;
  private attackIn = 3;
  private next = 0;
  private slamArm = 0;
  private volleyLeft = 0;
  private volleyT = 0;
  private readonly rest = new Vector3(0, 0, -9);
  /** Where the slamming hand lands, room space. */
  private readonly slamAt = new Vector3();
  private readonly handPos = [new Vector3(), new Vector3()];

  constructor() {
    super();
    const skin = this.rim(0x07050f, 0x05020c, 0x7a4dff);
    const cloak = this.rim(0x0b0718, 0x070312, 0x5a3dd0);
    const robe = new Mesh(new ConeGeometry(2.2, 5.5, 24, 1, true), cloak);
    (cloak as MeshStandardMaterial).side = DoubleSide;
    robe.position.y = 2.75;
    const torso = new Mesh(new SphereGeometry(1.25, 20, 14), skin);
    torso.scale.set(1.2, 1.1, 0.8);
    torso.position.y = 5.0;
    this.headG = pivotAt(0, 6.5, 0.2);
    const skull = new Mesh(new SphereGeometry(0.7, 18, 12), skin);
    skull.scale.set(1, 1.1, 0.95);
    this.headG.add(skull);
    for (const s of [-1, 1]) {
      const horn = new Mesh(new ConeGeometry(0.22, 1.6, 10), skin);
      horn.position.set(s * 0.6, 0.75, -0.1);
      horn.rotation.z = -s * 0.6;
      const eye = new Mesh(new SphereGeometry(0.11, 10, 8), this.glow(0xffc0ff));
      eye.position.set(s * 0.25, 0.05, 0.62);
      const glow = halo(0xc04dff, 0.9, 1);
      glow.position.copy(eye.position);
      this.eyes.push(glow);
      this.headG.add(horn, eye, glow);
    }
    const maw = new Mesh(new BoxGeometry(0.6, 0.08, 0.1), this.glow(0xff7ae0));
    maw.position.set(0, -0.32, 0.62);
    this.headG.add(maw);
    this.model.add(robe, torso, this.headG);
    // Chest core.
    const chestCore = new Mesh(new SphereGeometry(0.42, 18, 12), this.glow(0xf2c6ff));
    chestCore.position.set(0, 5.0, 1.0);
    chestCore.add(halo(0xb44dff, 2.4, 0.9));
    this.coreMeshes.push(chestCore);
    this.model.add(chestCore);
    this.chest = this.target(0.6, 6);
    // Arms (shoulder pivots) ending in clawed hands holding cores.
    this.hands = [];
    for (const s of [-1, 1]) {
      const shoulder = pivotAt(s * 1.45, 5.4, 0);
      const upper = cyl(0.32, 0.26, 2.6, skin);
      this.uppers.push(upper);
      shoulder.add(upper);
      const palm = pivotAt(0, -2.6, 0);
      const hand = new Mesh(new SphereGeometry(0.42, 14, 10), skin);
      hand.scale.set(1, 0.7, 1.2);
      for (let c = -1.5; c <= 1.5; c++) {
        const claw = new Mesh(new ConeGeometry(0.07, 0.6, 6), this.glow(0xd8b8ff));
        claw.position.set(c * 0.16, -0.25, 0.35);
        claw.rotation.x = Math.PI / 2 + 0.6;
        palm.add(claw);
      }
      const core = new Mesh(new SphereGeometry(0.2, 14, 10), this.glow(0xf2c6ff));
      core.position.set(0, 0.2, 0.25);
      core.add(halo(0xb44dff, 1.3, 0.9));
      this.coreMeshes.push(core);
      palm.add(hand, core);
      shoulder.add(palm);
      this.model.add(shoulder);
      this.arms.push(shoulder);
      this.palms.push(palm);
      this.hands.push(this.target(0.38, 3));
    }
    this.root.position.copy(this.rest);
    this.bake(...this.coreMeshes, ...this.uppers);
  }

  /** How many of its three cores are still burning. */
  get coresLeft(): number {
    return this.targets.filter((t) => t.alive).length;
  }

  protected override onHit(): void {
    /* The giant doesn't budge. */
  }

  protected syncTargets(): void {
    const s = this.root.scale.x;
    this.coreMeshes[0].getWorldPosition(this.chest.center);
    this.root.parent?.worldToLocal(this.chest.center);
    for (let i = 0; i < 2; i++) {
      this.coreMeshes[i + 1].getWorldPosition(this.hands[i].center);
      this.root.parent?.worldToLocal(this.hands[i].center);
    }
    for (let i = 0; i < 3; i++) this.coreMeshes[i].visible = this.targets[i].alive;
    void s;
  }

  protected think(dt: number, t: number, ctx: ArenaCtx): void {
    this.stateT += dt;
    const head = ctx.head;
    // Sway, breathe.
    this.model.position.y = Math.sin(t * 0.7) * 0.15;
    this.headG.rotation.y = Math.sin(t * 0.4) * 0.15;
    const rage = 3 - this.coresLeft; // faster as cores break
    let armTarget0 = 0.15;
    let armTarget1 = 0.15;
    switch (this.state) {
      case 'emerge':
        if (this.emerge >= 1) {
          ctx.sound('roar');
          this.setState('idle');
        }
        break;
      case 'idle':
        this.attackIn -= dt * (1 + rage * 0.35);
        if (this.attackIn <= 0) {
          const plan = ['volley', 'slam', 'volley', 'summon', 'slam'][this.next++ % 5];
          if (plan === 'slam' && !this.hands.some((h) => h.alive)) this.setState('volley');
          else this.setState(plan);
          const now = this.state as string;
          if (now === 'slam') {
            // Prefer a hand whose core is still alive.
            this.slamArm = this.hands[this.next % 2].alive ? this.next % 2 : 1 - (this.next % 2);
            ctx.sound('roar');
          }
          if (now === 'volley') {
            this.volleyLeft = 2 + rage;
            this.volleyT = 0.6;
            ctx.sound('cast');
          }
          if (now === 'summon') {
            ctx.sound('roar');
            ctx.summon('imp', 2);
          }
        }
        break;
      case 'volley':
        armTarget0 = armTarget1 = -1.1;
        this.volleyT -= dt;
        if (this.volleyT <= 0 && this.volleyLeft > 0) {
          this.volleyLeft--;
          this.volleyT = 0.9 - rage * 0.1;
          this.coreMeshes[0].getWorldPosition(tmp);
          this.root.parent?.worldToLocal(tmp);
          ctx.fireOrb(tmp, 2.6 + rage * 0.3, true, this);
        }
        if (this.volleyLeft <= 0 && this.volleyT <= -0.6) this.toIdle();
        break;
      case 'summon':
        armTarget0 = armTarget1 = -2.2;
        if (this.stateT > 1.6) this.toIdle();
        break;
      case 'slam':
        break;
    }
    // Arms swing toward their targets; the slamming arm reaches for the player.
    for (let i = 0; i < 2; i++) {
      const arm = this.arms[i];
      if (this.state === 'slam' && i === this.slamArm) continue;
      const want = i === 0 ? armTarget0 : armTarget1;
      arm.rotation.x += (want + Math.sin(t * 0.9 + i) * 0.08 - arm.rotation.x) * Math.min(1, dt * 2.5);
      arm.rotation.z += ((i === 0 ? -0.25 : 0.25) - arm.rotation.z) * Math.min(1, dt * 2.5);
      this.palms[i].position.set(0, -2.6, 0);
      this.uppers[i].scale.y = 1;
    }
    if (this.state === 'slam') this.updateSlam(dt, head, ctx);
    for (const e of this.eyes) e.scale.setScalar(0.9 + rage * 0.25 + 0.1 * Math.sin(t * 7));
  }

  private toIdle(): void {
    this.attackIn = 2.6;
    this.setState('idle');
  }

  /**
   * The hand rises (telegraph), sweeps down onto the ground right in front of
   * the player, stays pinned there (its core in reach of blade and whip),
   * then pulls back.
   */
  private updateSlam(dt: number, head: Vector3, ctx: ArenaCtx): void {
    const i = this.slamArm;
    const arm = this.arms[i];
    const palm = this.palms[i];
    const T = this.stateT;
    const side = i === 0 ? -1 : 1;
    this.slamAt.set(head.x + side * 0.35, 0.55, head.z - 1.3);
    // Shoulder in room space.
    arm.getWorldPosition(this.handPos[0]);
    this.root.parent?.worldToLocal(this.handPos[0]);
    const shoulder = this.handPos[0];
    let reach: Vector3;
    if (T < 1.3) {
      // Raise high.
      arm.rotation.x += (-2.6 - arm.rotation.x) * Math.min(1, dt * 3);
      palm.position.set(0, -2.6, 0);
      return;
    }
    if (T < 1.6) {
      const k = (T - 1.3) / 0.3;
      reach = tmp.copy(shoulder).lerp(this.slamAt, 0.4 + 0.6 * k);
    } else if (T < 5.2) {
      reach = tmp.copy(this.slamAt);
      reach.y += Math.max(0, Math.sin((T - 1.6) * 3)) * 0.04;
    } else if (T < 6.2) {
      const k = (T - 5.2) / 1.0;
      reach = tmp.copy(this.slamAt).lerp(shoulder, k * 0.6);
    } else {
      this.toIdle();
      return;
    }
    if (T >= 1.6 && T - dt < 1.6) {
      ctx.sound('slam');
      ctx.sparks.burst(this.slamAt, 40, 2.5, 0x8c5cff, 0.8, 4);
      ctx.strike(tmp2.copy(this.slamAt).setY(0.9), 1);
    }
    // Aim the arm from the shoulder to the reach point, stretching the forearm.
    tmp2.subVectors(reach, shoulder);
    const len = tmp2.length();
    // Arm local frame: hangs along -Y; rotate so -Y points along tmp2 (root yaw is ~0).
    const pitch = Math.atan2(-tmp2.z, -tmp2.y);
    arm.rotation.x = pitch;
    arm.rotation.z = Math.atan2(tmp2.x, Math.hypot(tmp2.y, tmp2.z)) * 1;
    const reachLen = Math.max(2.6, len - 0.2);
    palm.position.set(0, -reachLen, 0);
    this.uppers[i].scale.y = reachLen / 2.6;
  }
}

// ---------------------------------------------------------------------------
// Shadow rift: the doorway monsters crawl out of
// ---------------------------------------------------------------------------

function swirlTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(128, 128, 4, 128, 128, 128);
  grad.addColorStop(0, 'rgba(0,0,0,1)');
  grad.addColorStop(0.55, 'rgba(20,6,40,0.95)');
  grad.addColorStop(0.85, 'rgba(120,60,255,0.6)');
  grad.addColorStop(1, 'rgba(120,60,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(190,140,255,0.55)';
  g.lineWidth = 3;
  for (let arm = 0; arm < 5; arm++) {
    g.beginPath();
    for (let k = 0; k < 60; k++) {
      const a = arm * ((Math.PI * 2) / 5) + k * 0.09;
      const r = 12 + k * 1.8;
      const x = 128 + Math.cos(a) * r;
      const y = 128 + Math.sin(a) * r;
      if (k === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}
let swirl: CanvasTexture | undefined;

export class Rift {
  readonly root = new Group();
  private readonly disc: Mesh;
  private t = 0;
  done = false;

  constructor(
    at: Vector3,
    facing: Vector3,
    private readonly size = 1.2,
  ) {
    swirl ??= swirlTexture();
    this.disc = new Mesh(
      new CircleGeometry(0.5, 32),
      new MeshBasicMaterial({ map: swirl, transparent: true, depthWrite: false, side: DoubleSide, fog: false }),
    );
    const ring = new Mesh(
      new TorusGeometry(0.5, 0.025, 8, 48),
      new MeshBasicMaterial({ color: 0xb48cff, transparent: true, blending: AdditiveBlending, depthWrite: false, fog: false }),
    );
    this.root.add(this.disc, ring, halo(0x7a3cff, 2.2, 0.6));
    this.root.position.copy(at);
    this.root.lookAt(facing.x, at.y, facing.z);
    this.root.scale.setScalar(0.01);
  }

  update(dt: number): void {
    this.t += dt;
    const open = this.t < 0.5 ? this.t / 0.5 : this.t < 1.6 ? 1 : Math.max(0, 1 - (this.t - 1.6) / 0.5);
    this.root.scale.setScalar(Math.max(0.01, open * this.size));
    this.disc.rotation.z -= dt * 2.5;
    if (this.t > 2.1) {
      this.done = true;
      this.root.removeFromParent();
      this.disc.geometry.dispose();
    }
  }
}

export function makeMonster(kind: MonsterKind): Monster {
  if (kind === 'imp') return new Imp();
  if (kind === 'wraith') return new Wraith();
  if (kind === 'brute') return new Brute();
  return new ShadowEater();
}
