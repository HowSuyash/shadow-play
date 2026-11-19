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
import { boneTexture, claw, clothTexture, ironTextures, limb, profile, robe, skinTextures, skullGeo, Wisps } from './creatureKit.js';
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
  sound(kind: 'screech' | 'growl' | 'stomp' | 'cast' | 'slam' | 'roar' | 'whoosh', from?: Vector3): void;
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

  /** Shadow flesh: leathery near-black with glowing corruption veins. */
  protected skinMat(veins = 1): RimMat {
    const t = skinTextures();
    const m = rimMaterial({ color: 0xffffff, map: t.map, emissive: 0xffffff, emissiveMap: t.emissive, emissiveIntensity: 0.7 * veins, roughness: 0.78, metalness: 0.05 }, 0x3a2a6a, 3);
    this.mats.push(m);
    return m;
  }

  /** Blackened, scarred iron with molten cracks. */
  protected ironMat(): RimMat {
    const t = ironTextures();
    const m = rimMaterial({ color: 0xffffff, map: t.map, emissive: 0xffffff, emissiveMap: t.emissive, emissiveIntensity: 0.9, roughness: 0.42, metalness: 0.75 }, 0x4a4a8a, 3.2);
    this.mats.push(m);
    return m;
  }

  /** Old bone and horn. */
  protected boneMat(tint = 0xffffff): RimMat {
    const m = rimMaterial({ color: tint, map: boneTexture(), roughness: 0.7, metalness: 0.05, emissive: 0x0a0610, emissiveIntensity: 1 }, 0x3a2c5a, 3);
    this.mats.push(m);
    return m;
  }

  /** Tattered black cloth (torn hem, holes). */
  protected clothMat(): RimMat {
    const m = rimMaterial({ color: 0xffffff, map: clothTexture(), alphaTest: 0.5, side: DoubleSide, roughness: 0.95, metalness: 0, emissive: 0x06030c, emissiveIntensity: 1 }, 0x3a2c6a, 2.4);
    this.mats.push(m);
    return m;
  }

  /** Smoke or embers drifting off the body (model space). */
  protected wisps(...args: ConstructorParameters<typeof Wisps>): Wisps {
    const w = new Wisps(...args);
    this.smoke.push(w);
    this.model.add(w.points);
    return w;
  }
  private readonly smoke: Wisps[] = [];

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
    for (const w of this.smoke) w.update(dt);
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
      if (m.geometry) {
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
    const skin = this.skinMat(0.7);
    const bone = this.boneMat(0xb8aca0);
    const darkBone = this.boneMat(0x6a5e58);
    // Gaunt, hunched torso with ribs pushing through the skin.
    this.body = pivotAt(0, 0.5, 0);
    const pelvis = new Mesh(new SphereGeometry(0.085, 12, 8), skin);
    pelvis.scale.set(1.15, 0.7, 0.9);
    const torso = new Mesh(profile([0.0, 0, 0.07, 0.02, 0.08, 0.1, 0.115, 0.2, 0.145, 0.29, 0.13, 0.37, 0.07, 0.43, 0.0, 0.45]), skin);
    torso.scale.z = 0.78;
    this.body.add(pelvis, torso);
    for (let k = 0; k < 4; k++) {
      const r = [0.118, 0.135, 0.148, 0.142][k];
      const rib = new Mesh(new TorusGeometry(r * 0.99, 0.006, 4, 14, Math.PI), darkBone);
      rib.rotation.x = Math.PI / 2;
      rib.scale.set(1, 0.8, 1);
      rib.position.y = 0.19 + k * 0.05;
      this.body.add(rib);
    }
    // A ridge of spines down the back.
    for (let k = 0; k < 6; k++) {
      const sp = new Mesh(claw(0.05 + k * 0.012, 0.012, -0.5), darkBone);
      sp.position.set(0, 0.12 + k * 0.055, -0.1);
      sp.rotation.x = -1.1;
      this.body.add(sp);
    }
    // Long skull, open fanged jaw, slit eyes, swept-back horns.
    this.head = pivotAt(0, 0.42, 0.06);
    const skull = new Mesh(skullGeo(), skin);
    skull.scale.set(0.072, 0.066, 0.075);
    skull.position.z = 0.02;
    const jaw = pivotAt(0, -0.035, 0.02);
    jaw.rotation.x = 0.42;
    const jawM = new Mesh(new BoxGeometry(0.075, 0.018, 0.1), skin);
    jawM.position.set(0, -0.006, 0.045);
    jaw.add(jawM);
    for (let k = 0; k < 5; k++) {
      const x = -0.028 + k * 0.014;
      const up = new Mesh(claw(0.028, 0.004, 0.2), bone);
      up.position.set(x, -0.025, 0.085 - Math.abs(x) * 0.6);
      up.rotation.z = Math.PI;
      const lo = new Mesh(claw(0.022, 0.004, -0.2), bone);
      lo.position.set(x, 0.003, 0.085 - Math.abs(x) * 0.6);
      jaw.add(lo);
      this.head.add(up);
    }
    const throat = new Mesh(new SphereGeometry(0.02, 8, 6), this.glow(0xff3a9a));
    throat.position.set(0, -0.03, 0.05);
    this.head.add(skull, jaw, throat);
    for (const s of [-1, 1]) {
      const horn = new Mesh(claw(0.17, 0.02, -1.5), darkBone);
      horn.position.set(s * 0.045, 0.045, -0.01);
      horn.rotation.set(-0.5, 0, -s * 0.35);
      const eye = new Mesh(new SphereGeometry(1, 8, 6), this.glow(0xffd6ff));
      eye.scale.set(0.02, 0.0055, 0.008);
      eye.rotation.z = s * 0.38;
      eye.position.set(s * 0.033, 0.022, 0.1);
      const glow = halo(0xc040ff, 0.09, 0.85);
      glow.position.copy(eye.position);
      this.eyes.push(glow);
      this.head.add(horn, eye, glow);
    }
    this.body.add(this.head);
    // Long arms ending in curved talons.
    const arm = (s: number) => {
      const shoulder = pivotAt(s * 0.15, 0.34, 0.02);
      const upper = new Mesh(limb(0.034, 0.024, 0.26), skin);
      const elbow = pivotAt(0, -0.26, 0);
      elbow.rotation.x = -0.6;
      const fore = new Mesh(limb(0.026, 0.017, 0.26, 0.25), skin);
      const hand = pivotAt(0, -0.26, 0);
      const palm = new Mesh(new SphereGeometry(0.026, 8, 6), skin);
      palm.scale.set(1, 1.3, 0.6);
      hand.add(palm);
      for (let c = 0; c < 4; c++) {
        const t = new Mesh(claw(0.13 - Math.abs(c - 1.5) * 0.015, 0.0075, 1.1), bone);
        t.position.set((c - 1.5) * 0.014, -0.02, 0.01);
        t.rotation.set(0.15, 0, Math.PI + (c - 1.5) * 0.14);
        hand.add(t);
      }
      elbow.add(fore, hand);
      shoulder.add(upper, elbow);
      this.body.add(shoulder);
      return shoulder;
    };
    this.armL = arm(-1);
    this.armR = arm(1);
    // Reverse-jointed legs with taloned feet.
    const leg = (s: number) => {
      const hip = pivotAt(s * 0.08, 0.5, 0);
      const thighG = pivotAt(0, 0, 0);
      thighG.rotation.x = -0.55;
      const thigh = new Mesh(limb(0.048, 0.03, 0.24), skin);
      const knee = pivotAt(0, -0.24, 0);
      knee.rotation.x = 1.05;
      const shin = new Mesh(limb(0.03, 0.02, 0.24, 0.1), skin);
      const ankle = pivotAt(0, -0.24, 0);
      ankle.rotation.x = -0.6;
      const meta = new Mesh(limb(0.02, 0.016, 0.12, 0.05), skin);
      const foot = pivotAt(0, -0.12, 0);
      foot.rotation.x = 0.1;
      for (let c = -1; c <= 1; c++) {
        const t = new Mesh(claw(0.07, 0.008, 0.8), bone);
        t.position.set(c * 0.016, 0, 0);
        t.rotation.set(Math.PI / 2 - 0.2, c * 0.3, 0);
        foot.add(t);
      }
      ankle.add(meta, foot);
      knee.add(shin, ankle);
      thighG.add(thigh, knee);
      hip.add(thighG);
      this.model.add(hip);
      return hip;
    };
    this.legL = leg(-1);
    this.legR = leg(1);
    this.tail = pivotAt(0, 0.06, -0.1);
    const tail = new Mesh(claw(0.5, 0.026, 1.4, 8), skin);
    this.tail.add(tail);
    this.tail.rotation.x = -2.2;
    this.body.add(this.tail);
    this.model.add(this.body);
    this.wisps(14, 0.16, 0.25, 0.7, 0.24, 0x0a0410, 0.5, 0.22);
    this.wisps(8, 0.12, 0.3, 0.75, 0.02, 0xd070ff, 0.9, 0.35, true);
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
          ctx.sound('screech', this.root.position);
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
    for (const e of this.eyes) e.scale.setScalar(0.07 + raise * 0.06 + 0.01 * Math.sin(t * 13));
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
    const cloth = this.clothMat();
    const bone = this.boneMat(0x9a9490);
    const inner = new MeshBasicMaterial({ color: 0x020104 });
    // Layered tattered robes: a reaper drifting above the ground.
    const robeA = new Mesh(robe(0.15, 0.36, 1.2), cloth);
    robeA.position.y = 0.08;
    const robeB = new Mesh(robe(0.19, 0.44, 0.95), cloth);
    robeB.rotation.y = 0.7;
    const core = new Mesh(robe(0.11, 0.2, 0.75), inner);
    core.position.y = 0.05;
    const mantle = new Mesh(robe(0.07, 0.3, 0.36), cloth);
    mantle.position.y = 0.16;
    // A deep hood hiding a dim skull and two cold points of light.
    const hood = new Mesh(robe(0.03, 0.17, 0.34), cloth);
    hood.position.set(0, 0.42, 0);
    hood.rotation.x = 0.28;
    const face = new Mesh(new SphereGeometry(0.1, 12, 8), inner);
    face.position.set(0, 0.17, 0.04);
    const skull = new Mesh(skullGeo(), bone);
    skull.scale.set(0.05, 0.055, 0.045);
    skull.position.set(0, 0.17, 0.085);
    for (const s of [-1, 1]) {
      const eye = new Mesh(new SphereGeometry(0.011, 8, 6), this.glow(0xd8e4ff));
      eye.position.set(s * 0.022, 0.185, 0.13);
      const glow = halo(0x7d8cff, 0.1, 1);
      glow.position.copy(eye.position);
      this.eyes.push(glow);
      this.model.add(eye, glow);
      // Sleeves reaching toward the hands.
      const sleeve = new Mesh(robe(0.035, 0.085, 0.36, 10), cloth);
      sleeve.position.set(s * 0.17, 0.1, 0.03);
      sleeve.rotation.set(-0.45, 0, s * 0.42);
      this.model.add(sleeve);
    }
    // Tattered strips trailing below the robe.
    const stripGeo = new PlaneGeometry(0.09, 0.6, 1, 4);
    stripGeo.translate(0, -0.3, 0);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const r = new Mesh(stripGeo, cloth);
      r.position.set(Math.sin(a) * 0.3, -0.85, Math.cos(a) * 0.3);
      r.rotation.y = a;
      this.ribbons.push(r);
      this.model.add(r);
    }
    // Skeletal hands with long jointed fingers.
    const mkHand = (s: number) => {
      const h = pivotAt(s * 0.32, -0.3, 0.18);
      const palm = new Mesh(new BoxGeometry(0.05, 0.06, 0.018), bone);
      h.add(palm);
      for (let c = 0; c < 4; c++) {
        const f = new Mesh(claw(0.13, 0.006, 1.0), bone);
        f.position.set((c - 1.5) * 0.013, -0.03, 0);
        f.rotation.set(0.5, 0, Math.PI + (c - 1.5) * 0.1);
        h.add(f);
      }
      const th = new Mesh(claw(0.08, 0.006, 0.8), bone);
      th.position.set(-s * 0.026, -0.01, 0.01);
      th.rotation.set(0.7, 0, Math.PI - s * 0.7);
      h.add(th);
      this.model.add(h);
      return h;
    };
    this.handL = mkHand(-1);
    this.handR = mkHand(1);
    this.orb = new Mesh(new SphereGeometry(0.06, 12, 8), this.glow(0xe2d4ff));
    this.orbGlow = halo(0x8c6bff, 0.4, 0.9);
    this.orb.add(this.orbGlow);
    this.orb.position.set(0, -0.28, 0.32);
    this.model.add(robeA, robeB, core, mantle, hood, face, skull, this.orb);
    this.wisps(18, 0.26, -1.05, -0.5, 0.36, 0x05020a, 0.55, 0.06);
    this.wisps(8, 0.2, -0.9, 0.2, 0.02, 0x9ab0ff, 0.9, 0.25, true);
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
          ctx.sound('screech', this.root.position);
        } else {
          this.setState('cast');
          ctx.sound('cast', this.root.position);
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
    const skin = this.skinMat(0.6);
    const iron = this.ironMat();
    const horn = this.boneMat(0x5a504a);
    const rag = this.clothMat();
    this.body = pivotAt(0, 1.0, 0);
    // Barrel torso under a breastplate, the burning heart exposed through a rent in the iron.
    const torso = new Mesh(profile([0, -0.12, 0.26, -0.1, 0.33, 0.08, 0.41, 0.34, 0.43, 0.5, 0.31, 0.66, 0, 0.7], 16), skin);
    torso.scale.z = 0.76;
    const front = new Mesh(new CylinderGeometry(0.44, 0.36, 0.52, 18, 2, true, -Math.PI / 2, Math.PI), iron);
    front.scale.z = 0.82;
    front.position.y = 0.36;
    const back = new Mesh(new CylinderGeometry(0.44, 0.36, 0.52, 18, 2, true, Math.PI / 2, Math.PI), iron);
    back.scale.z = 0.82;
    back.position.y = 0.36;
    this.heart = new Mesh(new SphereGeometry(0.075, 12, 8), this.glow(0xd38bff));
    this.heart.position.set(0, 0.4, 0.33);
    const heartGlow = halo(0xa64dff, 0.45, 0.9);
    this.heart.add(heartGlow);
    const rent = new Mesh(new TorusGeometry(0.1, 0.028, 6, 10), iron);
    rent.position.set(0, 0.4, 0.33);
    const gorget = new Mesh(new CylinderGeometry(0.19, 0.3, 0.14, 14), iron);
    gorget.position.y = 0.66;
    const belt = new Mesh(new TorusGeometry(0.33, 0.045, 6, 20), iron);
    belt.rotation.x = Math.PI / 2;
    belt.scale.y = 0.8;
    belt.position.y = -0.06;
    const skirt = new Mesh(robe(0.32, 0.4, 0.42, 16), rag);
    skirt.position.y = -0.06;
    this.body.add(torso, front, back, this.heart, rent, gorget, belt, skirt);
    for (let k = 0; k < 4; k++) {
      const a = -0.9 + k * 0.6;
      const tasset = new Mesh(new BoxGeometry(0.17, 0.24, 0.025), iron);
      tasset.position.set(Math.sin(a) * 0.34, -0.2, Math.cos(a) * 0.28);
      tasset.rotation.set(0.15, a, 0);
      this.body.add(tasset);
    }
    // Great helm: T-shaped burning visor, bull horns.
    const helm = new Mesh(profile([0, 0, 0.15, 0, 0.165, 0.12, 0.155, 0.22, 0.11, 0.28, 0, 0.3], 16), iron);
    helm.position.set(0, 0.68, 0.1);
    const visorH = new Mesh(new BoxGeometry(0.2, 0.018, 0.02), this.glow(0xff7ae6));
    visorH.position.set(0, 0.84, 0.255);
    const visorV = new Mesh(new BoxGeometry(0.018, 0.1, 0.02), this.glow(0xff7ae6));
    visorV.position.set(0, 0.79, 0.258);
    this.body.add(helm, visorH, visorV);
    for (const s of [-1, 1]) {
      const h = new Mesh(claw(0.42, 0.05, 1.4, 8), horn);
      h.position.set(s * 0.14, 0.88, 0.1);
      h.rotation.set(0, 0, -s * 1.15);
      const eye = new Mesh(new SphereGeometry(0.014, 8, 6), this.glow(0xffd0ff));
      eye.position.set(s * 0.055, 0.84, 0.262);
      const glow = halo(0xd05cff, 0.12, 1);
      glow.position.copy(eye.position);
      this.eyes.push(glow);
      this.body.add(h, eye, glow);
      // Layered pauldrons with spikes.
      for (let k = 0; k < 3; k++) {
        const pad = new Mesh(new SphereGeometry(0.21 - k * 0.025, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), iron);
        pad.position.set(s * (0.44 + k * 0.03), 0.6 - k * 0.09, 0);
        pad.rotation.z = -s * (0.35 + k * 0.15);
        pad.scale.set(1, 0.7, 1.05);
        this.body.add(pad);
      }
      for (let k = 0; k < 2; k++) {
        const sp = new Mesh(claw(0.2 - k * 0.05, 0.03, -0.3), horn);
        sp.position.set(s * (0.42 + k * 0.08), 0.68 - k * 0.04, -0.04 + k * 0.08);
        sp.rotation.z = -s * (0.4 + k * 0.4);
        this.body.add(sp);
      }
    }
    const arm = (s: number, club: boolean) => {
      const shoulder = pivotAt(s * 0.45, 0.55, 0);
      const upper = new Mesh(limb(0.1, 0.085, 0.42, 0.22), skin);
      const brace = new Mesh(new CylinderGeometry(0.115, 0.105, 0.2, 12, 1, true), iron);
      brace.position.y = -0.2;
      const elbow = pivotAt(0, -0.42, 0);
      elbow.rotation.x = -0.3;
      const couter = new Mesh(new SphereGeometry(0.1, 10, 8), iron);
      const fore = new Mesh(limb(0.1, 0.12, 0.38, 0.05, 12), iron);
      for (let k = 0; k < 3; k++) {
        const sp = new Mesh(claw(0.09, 0.022, 0.2), horn);
        sp.position.set(s * 0.1, -0.1 - k * 0.1, -0.02);
        sp.rotation.z = -s * Math.PI / 2;
        elbow.add(sp);
      }
      const fist = new Mesh(new BoxGeometry(0.19, 0.17, 0.19), iron);
      fist.position.y = -0.46;
      elbow.add(couter, fore, fist);
      if (club) {
        // A flanged war-mace with a spiked crown.
        const mace = pivotAt(0, -0.44, 0);
        const shaft = new Mesh(new CylinderGeometry(0.03, 0.045, 0.9, 8), iron);
        shaft.position.set(0, 0, 0.38);
        shaft.rotation.x = Math.PI / 2;
        const headM = new Mesh(profile([0, -0.14, 0.09, -0.12, 0.13, 0, 0.09, 0.12, 0, 0.14], 10), iron);
        headM.position.set(0, 0, 0.82);
        headM.rotation.x = Math.PI / 2;
        mace.add(shaft, headM);
        for (let i = 0; i < 7; i++) {
          const a = (i / 7) * Math.PI * 2;
          const flange = new Mesh(new BoxGeometry(0.02, 0.1, 0.24), iron);
          flange.position.set(Math.cos(a) * 0.15, Math.sin(a) * 0.15, 0.82);
          flange.rotation.z = a - Math.PI / 2;
          mace.add(flange);
        }
        const tip = new Mesh(claw(0.18, 0.04, 0), horn);
        tip.position.set(0, 0, 0.95);
        tip.rotation.x = Math.PI / 2;
        mace.add(tip);
        elbow.add(mace);
      }
      shoulder.add(upper, brace, elbow);
      this.body.add(shoulder);
      return shoulder;
    };
    this.armL = arm(-1, false);
    this.armR = arm(1, true);
    const leg = (s: number) => {
      const hip = pivotAt(s * 0.22, 1.0, 0);
      const thigh = new Mesh(limb(0.13, 0.1, 0.5, 0.15), skin);
      const cuisse = new Mesh(new CylinderGeometry(0.14, 0.11, 0.38, 12, 1, true, -Math.PI / 2, Math.PI), iron);
      cuisse.position.y = -0.24;
      const knee = pivotAt(0, -0.5, 0);
      const poleyn = new Mesh(new SphereGeometry(0.1, 10, 8), iron);
      poleyn.position.z = 0.04;
      const shin = new Mesh(limb(0.1, 0.12, 0.46, 0.05, 12), iron);
      const foot = new Mesh(new BoxGeometry(0.2, 0.09, 0.3), iron);
      foot.position.set(0, -0.48, 0.05);
      const toe = new Mesh(claw(0.14, 0.06, 0), iron);
      toe.position.set(0, -0.48, 0.2);
      toe.rotation.x = Math.PI / 2;
      knee.add(poleyn, shin, foot, toe);
      hip.add(thigh, cuisse, knee);
      this.model.add(hip);
      return hip;
    };
    this.legL = leg(-1);
    this.legR = leg(1);
    this.model.add(this.body);
    this.wisps(16, 0.32, 1.3, 2.0, 0.42, 0x080410, 0.5, 0.3);
    this.wisps(12, 0.3, 1.2, 2.0, 0.03, 0xff70d0, 0.9, 0.45, true);
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
          ctx.sound('growl', this.root.position);
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
          ctx.sound('slam', this.root.position);
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
      ctx.sound('stomp', this.root.position);
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
    const bone = this.boneMat(0x8a8078);
    const cloth = this.clothMat();
    const inner = new MeshBasicMaterial({ color: 0x020104 });
    // Layered tattered robes falling from its shoulders to the ground.
    // Parted at the front so the ribcage and its burning heart show.
    const robeA = new Mesh(robe(1.3, 2.7, 5.5, 28, 0.55), cloth);
    robeA.position.y = 5.5;
    const robeB = new Mesh(robe(1.05, 2.35, 4.8, 28, 0.75), cloth);
    robeB.position.y = 5.3;
    const robeCore = new Mesh(robe(0.9, 1.7, 4.1, 16), inner);
    robeCore.position.y = 4.1;
    const mantle = new Mesh(robe(0.55, 2.0, 1.8, 24, 0.9), cloth);
    mantle.position.y = 6.1;
    // A ribcage around the burning heart.
    const chestDark = new Mesh(new SphereGeometry(0.85, 16, 12), inner);
    chestDark.position.set(0, 5.0, 0);
    chestDark.scale.set(1.1, 1.2, 0.8);
    this.model.add(robeA, robeB, robeCore, mantle, chestDark);
    for (let k = 0; k < 6; k++) {
      const r = [0.95, 1.08, 1.15, 1.15, 1.06, 0.9][k];
      const rib = new Mesh(new TorusGeometry(r, 0.075, 6, 18, Math.PI), bone);
      rib.rotation.set(Math.PI / 2 + 0.25, 0, 0);
      rib.scale.set(1, 0.8, 1);
      rib.position.set(0, 4.25 + k * 0.28, 0.05);
      this.model.add(rib);
    }
    const sternum = new Mesh(new BoxGeometry(0.16, 1.5, 0.12), bone);
    sternum.position.set(0, 5.0, 0.95);
    sternum.rotation.x = 0.12;
    this.model.add(sternum);
    for (let k = 0; k < 4; k++) {
      const v = new Mesh(new SphereGeometry(0.16 - k * 0.015, 10, 8), bone);
      v.position.set(0, 5.75 + k * 0.2, 0.05);
      this.model.add(v);
    }
    // Horned skull: crown of horns, slit eyes, hanging fanged jaw.
    this.headG = pivotAt(0, 6.5, 0.2);
    const skull = new Mesh(skullGeo(), bone);
    skull.scale.set(0.55, 0.6, 0.55);
    const jaw = pivotAt(0, -0.3, 0.15);
    jaw.rotation.x = 0.35;
    const jawM = new Mesh(new BoxGeometry(0.62, 0.14, 0.75), bone);
    jawM.position.set(0, -0.05, 0.3);
    jaw.add(jawM);
    for (let k = 0; k < 6; k++) {
      const x = -0.25 + k * 0.1;
      const up = new Mesh(claw(0.24, 0.035, 0.15), bone);
      up.position.set(x, -0.3, 0.68 - Math.abs(x) * 0.5);
      up.rotation.z = Math.PI;
      this.headG.add(up);
      const lo = new Mesh(claw(0.2, 0.03, -0.15), bone);
      lo.position.set(x, 0.02, 0.62 - Math.abs(x) * 0.5);
      jaw.add(lo);
    }
    const maw = new Mesh(new SphereGeometry(0.18, 10, 8), this.glow(0xff5ad0));
    maw.position.set(0, -0.32, 0.35);
    this.headG.add(skull, jaw, maw);
    for (const s of [-1, 1]) {
      const socket = new Mesh(new SphereGeometry(0.13, 10, 8), inner);
      socket.position.set(s * 0.22, 0.08, 0.5);
      const eye = new Mesh(new SphereGeometry(1, 10, 8), this.glow(0xffd0ff));
      eye.scale.set(0.11, 0.035, 0.05);
      eye.rotation.z = s * 0.35;
      eye.position.set(s * 0.22, 0.08, 0.6);
      const glow = halo(0xc04dff, 0.8, 1);
      glow.position.copy(eye.position);
      this.eyes.push(glow);
      const big = new Mesh(claw(2.2, 0.2, -2.3, 10), bone);
      big.position.set(s * 0.45, 0.4, -0.1);
      big.rotation.set(-0.3, 0, -s * 0.8);
      this.headG.add(socket, eye, glow, big);
      for (let k = 0; k < 3; k++) {
        const h = new Mesh(claw(0.9 + k * 0.25, 0.08, -0.6), bone);
        h.position.set(s * (0.12 + k * 0.14), 0.5, -0.05 - k * 0.05);
        h.rotation.set(-0.25, 0, -s * (0.15 + k * 0.25));
        this.headG.add(h);
      }
    }
    this.model.add(this.headG);
    // Chest core: the heart burning inside the ribs.
    const chestCore = new Mesh(new SphereGeometry(0.42, 18, 12), this.glow(0xf2c6ff));
    chestCore.position.set(0, 5.0, 1.0);
    chestCore.add(halo(0xb44dff, 2.4, 0.9));
    this.coreMeshes.push(chestCore);
    this.model.add(chestCore);
    this.chest = this.target(0.6, 6);
    // Arms: tattered sleeves over bone, ending in long-fingered claws holding cores.
    this.hands = [];
    for (const s of [-1, 1]) {
      const shoulder = pivotAt(s * 1.45, 5.4, 0);
      const upper = new Mesh(robe(0.5, 0.62, 2.6, 14), cloth);
      const armBone = new Mesh(limb(0.2, 0.13, 2.6, 0.1, 10), bone);
      upper.add(armBone);
      this.uppers.push(upper);
      shoulder.add(upper);
      const palm = pivotAt(0, -2.6, 0);
      const hand = new Mesh(new BoxGeometry(0.62, 0.28, 0.55), bone);
      hand.position.set(0, -0.05, 0.05);
      for (let c = 0; c < 4; c++) {
        const f = new Mesh(claw(1.15 - Math.abs(c - 1.5) * 0.12, 0.075, 1.5, 8), bone);
        f.position.set((c - 1.5) * 0.16, -0.15, 0.25);
        f.rotation.set(0.25, 0, Math.PI + (c - 1.5) * 0.08);
        palm.add(f);
      }
      const thumb = new Mesh(claw(0.7, 0.08, 1.2), bone);
      thumb.position.set(-s * 0.32, -0.08, 0.2);
      thumb.rotation.set(0.6, 0, Math.PI - s * 0.8);
      palm.add(thumb);
      // The core burns in front of the palm (between the claws), facing you.
      const core = new Mesh(new SphereGeometry(0.24, 14, 10), this.glow(0xf2c6ff));
      core.position.set(0, 0.12, 0.6);
      core.add(halo(0xb44dff, 1.6, 0.95));
      this.coreMeshes.push(core);
      palm.add(hand, core);
      shoulder.add(palm);
      this.model.add(shoulder);
      this.arms.push(shoulder);
      this.palms.push(palm);
      this.hands.push(this.target(0.38, 3));
    }
    this.wisps(30, 2.4, 0, 2.2, 1.7, 0x05020a, 0.5, 0.45);
    this.wisps(36, 1.6, 2.5, 7.5, 0.09, 0xc070ff, 0.9, 0.6, true);
    this.root.position.copy(this.rest);
    this.bake(...this.coreMeshes, ...this.uppers);
  }

  /** How many of its three cores are still burning. */
  get coresLeft(): number {
    let n = 0;
    for (const t of this.targets) if (t.alive) n++;
    return n;
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
          ctx.sound('roar', this.root.position);
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
            ctx.sound('roar', this.root.position);
          }
          if (now === 'volley') {
            this.volleyLeft = 2 + rage;
            this.volleyT = 0.6;
            ctx.sound('cast', this.root.position);
          }
          if (now === 'summon') {
            ctx.sound('roar', this.root.position);
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
      ctx.sound('slam', this.root.position);
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
