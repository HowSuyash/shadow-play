import { Group, Mesh, MeshBasicMaterial } from '@iwsdk/core';
import { sfx } from '../audio/sfx.js';
import { POSES, type PoseId } from '../hands/poseDetector.js';
import { STAGE } from '../scene/layout.js';
import type { Silhouette } from '../game/creatures.js';
import { makeCreature, makeGround } from '../game/levels.js';
import { ease } from '../game/shapes.js';
import { makeText, type Hint } from '../ui/wallUI.js';

type MemoryPhase = 'show' | 'input' | 'between' | 'done';

const START_LENGTH = 3;
const MAX_LENGTH = 8;
const LIVES = 3;
const SHOW_EACH = 1.1;
const GAP = 0.35;

/**
 * SHADOW MEMORY — the wall shows a sequence of creatures (with their hand
 * shapes); reproduce it in order with your hands. Each success adds one
 * more; three mistakes end the game. Played locally by each player.
 */
export class Memory {
  readonly root = new Group();
  phase: MemoryPhase = 'done';
  seq: PoseId[] = [];
  /** Position in the sequence being shown or answered. */
  index = 0;
  lives = LIVES;
  /** Longest sequence completed this game. */
  best = 0;
  private t = 0;
  private creature: Silhouette | undefined;
  private creatureT = 0;
  private texts: Mesh[] = [];

  constructor(private readonly hint: Hint) {
    this.root.position.z = STAGE.z;
    this.root.visible = false;
    this.root.add(makeGround());
  }

  start(rand = Math.random): void {
    this.root.visible = true;
    this.lives = LIVES;
    this.best = 0;
    this.seq = [];
    for (let i = 0; i < START_LENGTH; i++) this.seq.push(this.pick(rand));
    this.beginShow();
  }

  stop(): void {
    this.root.visible = false;
    this.phase = 'done';
    this.hint.show(null);
    this.setCreature(null);
    this.setTexts([]);
  }

  /** True while the player should be making shapes. */
  get listening(): boolean {
    return this.phase === 'input';
  }

  private pick(rand: () => number): PoseId {
    let p: PoseId;
    do p = POSES[Math.floor(rand() * POSES.length)];
    while (p === this.seq[this.seq.length - 1]);
    return p;
  }

  private beginShow(): void {
    this.phase = 'show';
    this.index = 0;
    this.t = -0.6;
    this.setTexts([[[`Remember ${this.seq.length} shadows`], 0.15, STAGE.titleY + 0.12], [this.livesLine(), 0.11, STAGE.titleY - 0.07]]);
  }

  private livesLine(): string[] {
    return [`${'♥ '.repeat(this.lives)}${'♡ '.repeat(LIVES - this.lives)}  ·  best ${this.best}`];
  }

  /** The player completed a shape. @returns true if it was the right one. */
  onPose(pose: PoseId): boolean {
    if (this.phase !== 'input') return false;
    const want = this.seq[this.index];
    if (pose === want) {
      this.setCreature(pose);
      sfx.note(POSES.indexOf(pose));
      this.index++;
      if (this.index >= this.seq.length) {
        this.best = Math.max(this.best, this.seq.length);
        sfx.levelComplete();
        this.phase = 'between';
        this.t = 0;
        this.setTexts([[['Perfect!'], 0.18, STAGE.titleY + 0.12], [this.livesLine(), 0.11, STAGE.titleY - 0.07]]);
      } else {
        this.setTexts([[[`${this.index} of ${this.seq.length}`], 0.15, STAGE.titleY + 0.12], [this.livesLine(), 0.11, STAGE.titleY - 0.07]]);
      }
      return true;
    }
    sfx.fizzle();
    this.lives--;
    this.setCreature(null);
    if (this.lives <= 0) {
      this.phase = 'done';
      this.hint.show(null);
      sfx.fanfare();
      this.setTexts([
        [['Shadow Memory'], 0.15, STAGE.titleY + 0.12],
        [[`You remembered ${this.best} shadows`], 0.17, STAGE.titleY - 0.1],
      ]);
    } else {
      // Show the same sequence again.
      this.beginShow();
    }
    return false;
  }

  update(dt: number, time: number): void {
    if (!this.root.visible) return;
    this.t += dt;
    if (this.phase === 'show') {
      const slot = SHOW_EACH + GAP;
      const i = Math.floor(Math.max(0, this.t) / slot);
      const within = Math.max(0, this.t) - i * slot;
      if (this.t >= 0 && i < this.seq.length) {
        if (i !== this.index || !this.creature) {
          this.index = i;
          this.setCreature(this.seq[i]);
          this.hint.show(this.seq[i], -0.55);
          sfx.note(POSES.indexOf(this.seq[i]));
        }
        if (within > SHOW_EACH) {
          this.setCreature(null);
          this.hint.show(null);
        }
      } else if (this.t >= 0 && i >= this.seq.length) {
        this.phase = 'input';
        this.index = 0;
        this.setCreature(null);
        this.hint.show(null);
        sfx.click();
        this.setTexts([[['Your turn!'], 0.18, STAGE.titleY + 0.12], [this.livesLine(), 0.11, STAGE.titleY - 0.07]]);
      }
    } else if (this.phase === 'between' && this.t > 1.8) {
      if (this.seq.length < MAX_LENGTH) this.seq.push(this.pick(Math.random));
      this.beginShow();
    }
    const c = this.creature;
    if (c) {
      this.creatureT = Math.min(1, this.creatureT + dt / 0.35);
      c.grow = Math.max(0.001, ease.backOut(this.creatureT));
      c.update(dt, time);
    }
  }

  private setCreature(pose: PoseId | null): void {
    if (this.creature) this.root.remove(this.creature.root);
    this.creature = undefined;
    if (!pose) return;
    const c = makeCreature(pose);
    c.root.position.set(0.55, STAGE.groundY + (pose === 'bird' ? 0.3 : 0), 0.003);
    c.placed();
    c.grow = 0.001;
    if (pose === 'bird') (c as unknown as { flapping: boolean }).flapping = true;
    this.creature = c;
    this.creatureT = 0;
    this.root.add(c.root);
  }

  private setTexts(lines: [string[], number, number][]): void {
    for (const t of this.texts) {
      t.removeFromParent();
      (t.material as MeshBasicMaterial).map?.dispose();
    }
    this.texts = lines.map(([l, h, y]) => {
      const m = makeText(l, h, { size: 64 });
      m.position.set(0, y, 0.004);
      this.root.add(m);
      return m;
    });
  }
}
