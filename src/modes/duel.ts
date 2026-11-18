import { Group, Mesh, MeshBasicMaterial } from '@iwsdk/core';
import { sfx } from '../audio/sfx.js';
import { POSES, type PoseId } from '../hands/poseDetector.js';
import { STAGE } from '../scene/layout.js';
import type { Silhouette } from '../game/creatures.js';
import { makeCreature, makeGround } from '../game/levels.js';
import { ease } from '../game/shapes.js';
import { makeText, type Hint } from '../ui/wallUI.js';

/** Who scored a round, from the host's point of view. */
export type DuelSide = 'host' | 'guest';

/** Duel messages (host decides; the guest only claims hits). */
export type DuelEvent =
  | { t: 'duel'; op: 'start'; targets: PoseId[] }
  | { t: 'duel'; op: 'hit'; i: number; pose: PoseId }
  | { t: 'duel'; op: 'point'; i: number; winner: DuelSide };

export const DUEL_ROUNDS = 5;
/** Pause after a point before the next creature appears. */
const BETWEEN_ROUNDS = 2.6;

export function randomTargets(n = DUEL_ROUNDS, rand = Math.random): PoseId[] {
  const out: PoseId[] = [];
  while (out.length < n) {
    const p = POSES[Math.floor(rand() * POSES.length)];
    if (p !== out[out.length - 1]) out.push(p);
  }
  return out;
}

/**
 * SHADOW DUEL — Gesture Challenge. A creature appears; the first player to
 * form its hand shadow (held 1 s) wins the round. Best of five.
 * Solo: the same rounds against the clock.
 *
 * Pure game logic lives here; networking is injected via `send`, and the
 * host is the only one allowed to award points (it validates every claim).
 */
export class Duel {
  readonly root = new Group();
  targets: PoseId[] = [];
  round = 0;
  /** Points by side; in solo only `host` (= you) is used. */
  readonly score: Record<DuelSide, number> = { host: 0, guest: 0 };
  open = false;
  done = false;
  private between = -1;
  private roundTime = 0;
  readonly roundTimes: number[] = [];
  private creature: Silhouette | undefined;
  private creatureT = 0;
  private winnerSide: DuelSide | null = null;
  private texts: Mesh[] = [];
  /** Results of every duel this session (shown on the duel end screen). */
  readonly history: string[] = [];

  /**
   * @param mySide which side this player is (solo players are 'host')
   * @param versus a partner is connected
   * @param send forwards a duel event to the partner (no-op in solo)
   */
  constructor(
    private readonly hint: Hint,
    private mySide: DuelSide,
    private versus: boolean,
    private readonly send: (e: DuelEvent) => void,
  ) {
    this.root.position.z = STAGE.z;
    this.root.visible = false;
    this.root.add(makeGround());
  }

  get isHost(): boolean {
    return this.mySide === 'host';
  }

  configure(mySide: DuelSide, versus: boolean): void {
    this.mySide = mySide;
    this.versus = versus;
  }

  /** Host (or solo): pick creatures and begin. */
  begin(): void {
    const targets = randomTargets();
    if (this.versus) this.send({ t: 'duel', op: 'start', targets });
    this.start(targets);
  }

  /** Both sides: start a match with the host's creature list. */
  start(targets: PoseId[]): void {
    this.targets = targets;
    this.round = 0;
    this.score.host = this.score.guest = 0;
    this.roundTimes.length = 0;
    this.done = false;
    this.root.visible = true;
    this.startRound();
  }

  stop(): void {
    this.root.visible = false;
    this.open = false;
    this.hint.show(null);
    this.clearCreature();
    this.setTexts([]);
  }

  /** The local player completed a pose. */
  localHit(pose: PoseId): void {
    if (!this.open || pose !== this.targets[this.round]) return;
    if (this.isHost) this.award(this.mySide);
    else this.send({ t: 'duel', op: 'hit', i: this.round, pose });
  }

  /** Network input. Host validates guest claims; guest applies host decisions. */
  onEvent(e: DuelEvent): void {
    if (e.op === 'start') {
      if (!this.isHost) this.start(e.targets);
    } else if (e.op === 'hit') {
      // Never trust a claim blindly: right round, right creature, round still open.
      if (this.isHost && this.open && e.i === this.round && e.pose === this.targets[this.round]) this.award('guest');
    } else if (e.op === 'point') {
      if (!this.isHost && e.i === this.round) this.applyPoint(e.winner);
    }
  }

  private award(side: DuelSide): void {
    if (this.versus) this.send({ t: 'duel', op: 'point', i: this.round, winner: side });
    this.applyPoint(side);
  }

  private applyPoint(side: DuelSide): void {
    if (!this.open) return;
    this.open = false;
    this.score[side]++;
    this.roundTimes.push(this.roundTime);
    this.winnerSide = side;
    this.creatureT = 0;
    this.hint.show(null);
    sfx.success();
    if (side === this.mySide) sfx.levelComplete();
    this.between = 0;
    this.refreshTexts();
  }

  private startRound(): void {
    const target = this.targets[this.round];
    this.open = true;
    this.roundTime = 0;
    this.winnerSide = null;
    this.clearCreature();
    this.creature = makeCreature(target);
    this.creature.root.position.set(0.55, STAGE.groundY + (target === 'bird' ? 0.3 : 0), 0.003);
    this.creature.grow = 0.001;
    this.creature.placed();
    if (target === 'bird') (this.creature as unknown as { flapping: boolean }).flapping = true;
    this.root.add(this.creature.root);
    this.creatureT = 0;
    this.hint.show(target, -0.55);
    sfx.click();
    this.refreshTexts();
  }

  private clearCreature(): void {
    if (this.creature) this.root.remove(this.creature.root);
    this.creature = undefined;
  }

  private label(side: DuelSide): string {
    return side === this.mySide ? 'You' : 'Rival';
  }

  private refreshTexts(): void {
    const lines: [string[], number, number, number][] = [];
    const n = Math.min(this.round + 1, DUEL_ROUNDS);
    if (this.versus) {
      const me = this.score[this.mySide];
      const them = this.score[this.mySide === 'host' ? 'guest' : 'host'];
      lines.push([[`You ${me}  ·  ${them} Rival`], 0.16, 0, STAGE.titleY + 0.12]);
    } else {
      const total = this.roundTimes.reduce((a, b) => a + b, 0);
      lines.push([[`Gesture Challenge  ·  ${total.toFixed(1)} s`], 0.16, 0, STAGE.titleY + 0.12]);
    }
    if (this.done) {
      lines.push([[this.resultLine()], 0.2, 0, STAGE.titleY - 0.12]);
      if (this.history.length) lines.push([['this session', ...this.history.slice(-4)], 0.3, 0, STAGE.groundY + 0.25]);
    } else if (this.open) {
      lines.push([[`round ${n} of ${DUEL_ROUNDS}  ·  make the ${this.targets[this.round].toUpperCase()}!`], 0.1, 0, STAGE.titleY - 0.1]);
    } else if (this.winnerSide) {
      lines.push([[this.versus ? `${this.label(this.winnerSide)} got it!` : `${this.roundTimes[this.roundTimes.length - 1].toFixed(1)} s`], 0.14, 0, STAGE.titleY - 0.1]);
    }
    this.setTexts(lines);
  }

  private resultLine(): string {
    if (!this.versus) {
      const total = this.roundTimes.reduce((a, b) => a + b, 0);
      return `All five in ${total.toFixed(1)} seconds`;
    }
    const me = this.score[this.mySide];
    const them = this.score[this.mySide === 'host' ? 'guest' : 'host'];
    return me > them ? 'You win the duel!' : me < them ? 'Your rival wins this time' : "It's a draw!";
  }

  /** True when the local player won (for progress). */
  get localWon(): boolean {
    const me = this.score[this.mySide];
    const them = this.score[this.mySide === 'host' ? 'guest' : 'host'];
    return this.versus ? me > them : true;
  }

  private setTexts(lines: [string[], number, number, number][]): void {
    for (const t of this.texts) {
      t.removeFromParent();
      (t.material as MeshBasicMaterial).map?.dispose();
    }
    this.texts = lines.map(([l, h, x, y]) => {
      const m = makeText(l, h, { size: 64 });
      m.position.set(x, y, 0.004);
      this.root.add(m);
      return m;
    });
  }

  update(dt: number, time: number): void {
    if (!this.root.visible) return;
    if (this.open) this.roundTime += dt;
    const c = this.creature;
    if (c) {
      this.creatureT = Math.min(1, this.creatureT + dt / 0.6);
      if (this.winnerSide) {
        // The creature dashes toward whoever won it.
        const dir = this.versus && this.winnerSide !== this.mySide ? 1 : -1;
        c.facing = dir as 1 | -1;
        c.root.position.x += dir * dt * 0.7;
      } else {
        c.grow = Math.max(0.001, ease.backOut(this.creatureT));
      }
      c.update(dt, time);
    }
    if (this.between >= 0) {
      this.between += dt;
      if (this.between > BETWEEN_ROUNDS) {
        this.between = -1;
        this.round++;
        if (this.round >= DUEL_ROUNDS) this.finish();
        else this.startRound();
      }
    }
  }

  private finish(): void {
    this.done = true;
    this.open = false;
    this.clearCreature();
    const line = this.versus
      ? `You ${this.score[this.mySide]} – ${this.score[this.mySide === 'host' ? 'guest' : 'host']} Rival`
      : `${this.roundTimes.reduce((a, b) => a + b, 0).toFixed(1)} s solo`;
    this.history.push(line);
    sfx.fanfare();
    this.refreshTexts();
  }
}
