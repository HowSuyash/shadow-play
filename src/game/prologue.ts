import { Group, Vector3 } from '@iwsdk/core';
import { HandRig } from '../battle/rig.js';
import { makeWeapon, Whip, type Weapon } from '../battle/weapons.js';
import type { PoseId } from '../hands/poseDetector.js';
import { STAGE } from '../scene/layout.js';
import { makeCandleProp, type Silhouette } from './creatures.js';
import { ShadowEater } from './finalLevels.js';
import { GROUND, makeCreature } from './levels.js';

const ORDER: PoseId[] = ['dog', 'bird', 'rabbit', 'snake'];
const WEAPONS = { dog: 'blade', bird: 'firebird', rabbit: 'shield', snake: 'whip' } as const;

/**
 * The prologue's shadow-puppet scenes, played on the wall behind the story
 * cards: the old puppeteers' creatures, the Shadow Eater swallowing the
 * light, the last candle, and finally the four shadows with the real
 * weapons they will become, floating out of the wall toward you.
 */
export class Prologue {
  readonly root = new Group();
  private card = -1;
  private t = 0;
  private readonly dog: Silhouette;
  private readonly bird: Silhouette;
  private readonly eater = new ShadowEater();
  private readonly candle = makeCandleProp();
  private readonly cast: Silhouette[];
  private readonly weapons: Weapon[] = [];
  private readonly rigs: HandRig[] = [];
  private readonly at = new Vector3();
  private readonly fwd = new Vector3(0, 0, 1);
  private readonly up = new Vector3(0, 1, 0);
  private readonly out = new Vector3(0, 0, 1);

  constructor() {
    this.dog = makeCreature('dog');
    this.bird = makeCreature('bird');
    this.cast = ORDER.map((p) => makeCreature(p));
    this.root.add(this.dog.root, this.bird.root, this.eater.root, this.candle.root, ...this.cast.map((c) => c.root));
    this.candle.root.position.set(0, GROUND, STAGE.z + 0.004);
    this.candle.root.scale.setScalar(1.6);
    this.eater.root.position.set(0, GROUND, STAGE.z + 0.003);
    ORDER.forEach((p, i) => {
      const w = makeWeapon(WEAPONS[p], 'right');
      w.form = 1;
      this.root.add(w.root);
      if (w instanceof Whip) w.attach(this.root);
      this.weapons.push(w);
      this.rigs.push(new HandRig('right'));
      this.cast[i].root.position.set(-0.9 + i * 0.6, GROUND, STAGE.z + 0.004);
    });
    this.hideAll();
    this.root.visible = false;
  }

  private hideAll(): void {
    for (const s of [this.dog, this.bird, ...this.cast]) s.fade(0, true);
    this.eater.root.visible = false;
    this.candle.root.visible = false;
    // An untracked hand hides a weapon (and the whip's rope, head and trail).
    this.weapons.forEach((w, i) => {
      this.rigs[i].lose();
      w.update(0, 0, this.rigs[i]);
    });
  }

  /** Show the scene for story card `i` (0–3). */
  show(i: number): void {
    this.root.visible = true;
    this.card = i;
    this.t = 0;
    this.hideAll();
    if (i === 0) {
      this.dog.fade(1, true);
      this.bird.fade(1, true);
      this.dog.root.position.set(-1.6, GROUND, STAGE.z + 0.004);
      this.bird.root.position.set(-1.9, GROUND + 0.55, STAGE.z + 0.005);
      this.dog.placed();
      this.bird.placed();
    } else if (i === 1) {
      this.eater.reset();
      this.eater.root.visible = true;
      this.dog.fade(1, true);
      this.dog.root.position.set(0.3, GROUND, STAGE.z + 0.004);
      this.dog.placed();
    } else if (i === 2) {
      this.candle.root.visible = true;
    } else if (i === 3) {
      for (const c of this.cast) c.fade(1);
    }
  }

  hide(): void {
    this.card = -1;
    this.hideAll();
    this.root.visible = false;
  }

  update(dt: number, time: number): void {
    if (this.card < 0) return;
    this.t += dt;
    const t = this.t;
    if (this.card === 0) {
      // The puppeteers' creatures play across the wall.
      this.dog.root.position.x = -1.6 + t * 0.55;
      this.dog.facing = 1;
      this.bird.root.position.x = -1.9 + t * 0.75;
      this.bird.root.position.y = GROUND + 0.55 + Math.sin(t * 2) * 0.08;
      this.bird.facing = 1;
    } else if (this.card === 1) {
      // The Shadow Eater rises; the dog flees.
      const k = Math.min(1, t / 1.6);
      this.eater.root.scale.setScalar(0.2 + 1.5 * k * k * (3 - 2 * k));
      this.dog.facing = 1;
      if (t > 1.2) this.dog.root.position.x = 0.3 + (t - 1.2) * 1.1;
      if (t > 2.2) this.dog.fade(0);
      this.eater.update(dt, time);
      this.eater.root.scale.setScalar(0.2 + 1.5 * k * k * (3 - 2 * k));
    } else if (this.card === 2) {
      this.candle.glowMesh.scale.setScalar(1.6 + 0.25 * Math.sin(time * 9) + 0.15 * Math.sin(time * 23));
    } else if (this.card === 3) {
      // Each shadow's weapon drifts out of the wall toward you.
      ORDER.forEach((_p, i) => {
        const w = this.weapons[i];
        const k = Math.min(1, Math.max(0, (t - 0.4 - i * 0.35) / 1.2));
        w.root.visible = k > 0;
        if (k <= 0) return;
        const e = k * k * (3 - 2 * k);
        this.at.set(-0.9 + i * 0.6, GROUND + 0.35 + Math.sin(time * 1.8 + i) * 0.03, STAGE.z + 0.05 + e * 0.5);
        // A fake hand that holds each weapon up for display, turning slowly.
        const a = Math.sin(time * 0.9 + i) * 0.5;
        this.fwd.set(Math.sin(a), 0, Math.cos(a));
        this.out.set(Math.sin(a), 0, Math.cos(a));
        this.rigs[i].fromFrame(this.at, this.fwd, this.up, this.out, false, false, dt);
        w.update(dt, time, this.rigs[i]);
        w.root.scale.multiplyScalar(e);
      });
    }
    for (const s of [this.dog, this.bird, ...this.cast]) s.update(dt, time);
  }
}
