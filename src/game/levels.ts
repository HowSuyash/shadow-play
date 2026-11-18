import { Group, Vector3 } from '@iwsdk/core';
import { sfx } from '../audio/sfx.js';
import type { PoseId } from '../hands/poseDetector.js';
import type { Room } from '../scene/room.js';
import { STAGE } from '../scene/layout.js';
import { Bird, Dog, makeCandleProp, Rabbit, Thief, type Silhouette } from './creatures.js';
import { ease, part, poly, ScriptRunner, shadowMaterial, tween, wait, type Script } from './shapes.js';

const GROUND = STAGE.groundY;
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

export function makeCreature(pose: PoseId): Silhouette {
  return pose === 'dog' ? new Dog() : pose === 'bird' ? new Bird() : new Rabbit();
}

/** Uneven earth along the bottom of the stage; creatures walk on its top edge. */
export function makeGround(from = STAGE.left - 2.2, to = STAGE.right + 2.2): Group {
  const pts: number[] = [];
  const steps = 60;
  for (let i = 0; i <= steps; i++) {
    const x = from + ((to - from) * i) / steps;
    pts.push(x, GROUND - 0.006 + Math.sin(i * 2.3) * 0.006 + Math.sin(i * 0.7) * 0.008);
  }
  // Reach down to the floor so no lit edge shows under the stage.
  pts.push(to, GROUND - 1.4, from, GROUND - 1.4);
  const g = new Group();
  g.add(part([poly(pts)], shadowMaterial()));
  return g;
}

/**
 * A level is a little 2D shadow-play on the wall. Idle animation runs until
 * the right creature is summoned, then a scripted "solve" cutscene plays.
 * Summoning the wrong creature plays a short puzzled reaction instead.
 */
export abstract class Level {
  abstract readonly numeral: string;
  abstract readonly title: string;
  abstract readonly pose: PoseId;
  readonly root = new Group();
  /** Every silhouette that needs a per-frame update. */
  protected readonly actors: Silhouette[] = [];
  protected readonly script = new ScriptRunner();
  solved = false;

  constructor(protected readonly room: Room) {
    this.root.position.z = STAGE.z;
    this.root.visible = false;
  }

  /** True while a cutscene plays (pose input is ignored). */
  get busy(): boolean {
    return this.script.running;
  }

  enter(): void {
    this.solved = false;
    this.script.stop();
    this.reset();
    this.root.visible = true;
  }

  exit(): void {
    this.script.stop();
    this.root.visible = false;
  }

  summon(pose: PoseId, spawn: Vector3): void {
    this.script.start(pose === this.pose ? this.solve(spawn) : this.wrong(pose, spawn));
  }

  update(dt: number, time: number): void {
    this.script.update(dt);
    this.tick(dt, time);
    for (const a of this.actors) a.update(dt, time);
  }

  protected abstract reset(): void;
  protected abstract solve(spawn: Vector3): Script;
  /** Idle animation hook. */
  protected tick(_dt: number, _time: number): void {}

  protected add(...actors: Silhouette[]): void {
    for (const a of actors) {
      this.actors.push(a);
      this.root.add(a.root);
    }
  }

  /** The creature peels off the hand's shadow, then (unless it flies) drops to the ground. */
  protected *emerge(c: Silhouette, spawn: Vector3, land = true): Script {
    c.root.visible = true;
    c.fade(1, true);
    c.root.position.set(spawn.x, spawn.y - 0.12, 0.003);
    c.placed();
    c.grow = 0;
    yield* tween(0.55, (k) => (c.grow = Math.max(0.001, ease.backOut(k))));
    if (!land) return;
    const y0 = c.root.position.y;
    yield* tween(0.4, (k) => (c.root.position.y = lerp(y0, GROUND, ease.in(k))));
    yield* tween(0.18, (k) => (c.root.position.y = GROUND + Math.sin(k * Math.PI) * 0.03));
  }

  /** Move an actor horizontally at `speed` m/s, turning to face where it goes. */
  protected *walkTo(c: Silhouette, x: number, speed: number, easing = ease.inOut): Script {
    const x0 = c.root.position.x;
    if (Math.abs(x - x0) < 0.005) return;
    c.facing = x > x0 ? 1 : -1;
    yield* tween(Math.abs(x - x0) / speed, (k) => (c.root.position.x = lerp(x0, x, easing(k))));
  }

  /** Wrong creature: it appears, looks around, shrugs, and fades away. */
  protected *wrong(pose: PoseId, spawn: Vector3): Script {
    const c = makeCreature(pose);
    this.add(c);
    const flies = pose === 'bird';
    yield* this.emerge(c, spawn, !flies);
    yield* wait(0.3);
    for (let i = 0; i < 2; i++) {
      c.facing = c.facing === 1 ? -1 : 1;
      yield* wait(0.45);
    }
    sfx.fizzle();
    c.fade(0);
    yield* wait(0.7);
    this.root.remove(c.root);
    this.actors.splice(this.actors.indexOf(c), 1);
  }
}

// ---------------------------------------------------------------------------
// Level 1 — The Thief
// ---------------------------------------------------------------------------

export class ThiefLevel extends Level {
  readonly numeral = 'I';
  readonly title = 'The Thief';
  readonly pose: PoseId = 'dog';

  private readonly thief = new Thief();
  private readonly dog = new Dog();
  private readonly prop = makeCandleProp();
  private readonly standX = 0.3;
  private readonly idle = new ScriptRunner();
  private readonly tmp = new Vector3();
  private glowBoost = 1;

  constructor(room: Room) {
    super(room);
    this.root.add(makeGround());
    this.prop.root.position.set(this.standX, GROUND, 0.001);
    this.root.add(this.prop.root);
    this.add(this.thief, this.dog);
  }

  protected reset(): void {
    // Candle back on its stand.
    this.prop.root.add(this.prop.candle);
    this.prop.candle.position.set(0, 0.185, 0);
    this.prop.candle.rotation.set(0, 0, 0);
    this.prop.candle.scale.setScalar(1);
    this.glowBoost = 1;
    this.thief.root.position.set(1.5, GROUND, 0.002);
    this.thief.placed();
    this.thief.scared = false;
    this.thief.fade(1, true);
    this.thief.arm.rotation.z = 0;
    this.dog.root.visible = false;
    this.dog.fade(0, true);
    this.idle.start(this.thiefLoop());
  }

  protected tick(dt: number, time: number): void {
    this.idle.update(dt);
    // The real candle flame's flicker, echoed in the shadow world.
    this.prop.glowMesh.scale.setScalar(this.glowBoost * (1 + 0.06 * Math.sin(time * 9.7)));
  }

  /** Sneak in, steal the candle, then loiter nervously (never escapes: no fail state). */
  private *thiefLoop(): Script {
    const t = this.thief;
    t.sneaking = true;
    yield* wait(1.5);
    yield* this.walkTo(t, this.standX + 0.2, 0.2);
    yield* tween(0.7, (k) => (t.arm.rotation.z = -0.35 * ease.inOut(k)));
    t.hand.attach(this.prop.candle);
    this.prop.candle.position.set(0, -0.2, 0);
    this.prop.candle.rotation.set(0, 0, 0.35);
    yield* tween(0.6, (k) => (t.arm.rotation.z = -0.35 + 0.55 * ease.inOut(k)));
    yield* this.walkTo(t, 0.95, 0.09);
    for (;;) {
      t.facing = -1; // nervous glance back
      yield* wait(1.3);
      t.facing = 1;
      yield* tween(1.6, (k) => (t.root.position.x = 0.95 + Math.sin(k * Math.PI) * 0.04));
      yield* wait(0.8);
    }
  }

  protected *solve(spawn: Vector3): Script {
    this.idle.stop();
    const t = this.thief;
    const d = this.dog;
    yield* this.emerge(d, spawn);
    yield* this.walkTo(d, Math.min(t.root.position.x - 0.6, 0.15), 1.0);
    d.facing = 1;
    t.facing = -1;
    for (let i = 0; i < 2; i++) {
      d.bark();
      sfx.bark();
      yield* wait(0.65);
    }
    // Startled jump.
    t.scared = true;
    t.sneaking = false;
    const y0 = t.root.position.y;
    yield* tween(0.35, (k) => (t.root.position.y = y0 + Math.sin(k * Math.PI) * 0.14));
    sfx.flee();
    // The candle is flung back onto its stand.
    const candle = this.prop.candle;
    if (candle.parent !== this.prop.root) {
      this.root.attach(candle);
      const from = candle.position.clone();
      const rot = candle.rotation.z;
      this.tmp.set(this.standX, GROUND + 0.185, 0.001);
      const to = this.tmp;
      t.facing = 1;
      const fleeFrom = t.root.position.x;
      yield* tween(1.1, (k) => {
        candle.position.set(lerp(from.x, to.x, k), lerp(from.y, to.y, k) + Math.sin(k * Math.PI) * 0.25, 0.001);
        candle.rotation.z = lerp(rot, 0, k);
        t.root.position.x = lerp(fleeFrom, 2.0, ease.in(k));
      });
      this.prop.root.attach(candle);
      candle.position.set(0, 0.185, 0);
      candle.rotation.set(0, 0, 0);
    } else {
      t.facing = 1;
      yield* this.walkTo(t, 2.0, 1.6, ease.in);
    }
    t.fade(0);
    // The dog trots over and sits proudly by the candle.
    yield* this.walkTo(d, this.standX - 0.32, 0.6);
    d.facing = 1;
    yield* tween(0.8, (k) => (this.glowBoost = 1 + k * 0.7));
    yield* wait(1.2);
    this.solved = true;
  }
}
