import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Battle, BATTLES, type BattleInput } from '../src/battle/battle.js';
import { segmentDistance } from '../src/battle/fx.js';
import { ShadowEater, Wraith } from '../src/battle/monsters.js';
import { HandRig } from '../src/battle/rig.js';
import { Shield, WEAPON_OF, WhipRope, WHIP_SEG_LEN, WHIP_SEGMENTS } from '../src/battle/weapons.js';
import type { PoseDetector, PoseResult } from '../src/hands/poseDetector.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const DT = 1 / 60;

function makeInput(): BattleInput {
  const pose: PoseResult = { charging: null, progress: 0, triggered: null, anchor: new Vector3() };
  const hand = { tracked: false, palmCenter: new Vector3() };
  const poses = { left: hand, right: hand, reset: () => {} } as unknown as PoseDetector;
  return { head: new Vector3(0, 1.2, 0), headDir: new Vector3(0, 0, -1), pose, poses, equip: null, aim: null };
}

/** Advance the battle `seconds`, optionally running `each` before every frame. */
function run(b: Battle, input: BattleInput, seconds: number, each?: () => void): void {
  for (let t = 0; t < seconds; t += DT) {
    each?.();
    b.update(DT, t, input);
    input.equip = null;
  }
}

/** Defeat everything currently on the field. */
function killAll(b: Battle): void {
  for (const m of b.monsters) for (const t of m.targets) if (t.alive) m.hit(t, 99, new Vector3(0, 0, -1));
}

describe('battle maths', () => {
  it('measures point–segment distance', () => {
    const a = new Vector3(0, 0, 0);
    const b = new Vector3(1, 0, 0);
    expect(segmentDistance(new Vector3(0.5, 0.3, 0), a, b)).toBeCloseTo(0.3);
    expect(segmentDistance(new Vector3(-1, 0, 0), a, b)).toBeCloseTo(1);
    expect(segmentDistance(new Vector3(2, 0, 0), a, a)).toBeCloseTo(2);
  });

  it('keeps the serpent whip at its length while it is flicked around', () => {
    const rope = new WhipRope();
    const root = new Vector3(0, 1, -0.4);
    const dir = new Vector3(0, 0.3, -1).normalize();
    for (let i = 0; i < 240; i++) {
      root.x = Math.sin(i * 0.2) * 0.3; // wild flicks
      rope.step(root, dir, DT);
    }
    expect(rope.p[0].distanceTo(root)).toBeLessThan(1e-6);
    for (let i = 0; i < WHIP_SEGMENTS; i++) {
      expect(rope.p[i].distanceTo(rope.p[i + 1])).toBeCloseTo(WHIP_SEG_LEN, 1);
    }
    // A flick makes the tip move much faster than the hand.
    expect(rope.speed[WHIP_SEGMENTS]).toBeGreaterThan(0);
  });

  it('tracks hand velocity and builds an orthonormal grip frame', () => {
    const rig = new HandRig('right');
    const fwd = new Vector3(0, 0, -1);
    const side = new Vector3(0, 1, 0);
    const normal = new Vector3(-1, 0, 0);
    rig.fromFrame(new Vector3(0, 1, -0.4), fwd, side, normal, false, false, DT);
    for (let i = 1; i <= 10; i++) rig.fromFrame(new Vector3(i * 0.05, 1, -0.4), fwd, side, normal, false, false, DT);
    expect(rig.vel.x).toBeGreaterThan(2.5); // 0.05 m per frame at 60 fps = 3 m/s
    const y = new Vector3(0, 1, 0).applyQuaternion(rig.quat);
    expect(y.distanceTo(side)).toBeLessThan(1e-5);
  });

  it('maps every shadow to its weapon', () => {
    expect(WEAPON_OF).toEqual({ dog: 'blade', bird: 'firebird', rabbit: 'shield', snake: 'whip' });
  });
});

describe('battles', () => {
  it('has a battle for each of the five chapters, ending with the boss', () => {
    expect(BATTLES).toHaveLength(5);
    expect(BATTLES[4].boss).toBe(true);
    expect(new Set(BATTLES.map((b) => b.feature))).toEqual(new Set(['bird', 'dog', 'rabbit', 'snake']));
  });

  it('runs intro → weapon → every wave → victory', () => {
    const b = new Battle();
    const input = makeInput();
    b.start(1);
    expect(b.state).toBe('intro');
    input.equip = { pose: 'dog', hand: 'right' };
    run(b, input, 0.1);
    expect(b.weapons.right?.id).toBe('blade');
    run(b, input, 7); // intro + how-to
    expect(b.state).toBe('fight');
    let guard = 0;
    while (b.state !== 'won' && guard++ < 80) {
      run(b, input, 1.5);
      killAll(b);
    }
    expect(b.state).toBe('won');
    expect(b.kills).toBe(BATTLES[1].waves.reduce((n, w) => n + w.list.length, 0));
    run(b, input, 5);
    expect(b.finished).toBe(true);
  });

  it('never gets stuck: the featured shadow arrives anyway after a while', () => {
    const b = new Battle();
    const input = makeInput();
    b.start(0);
    run(b, input, 4);
    expect(b.state).toBe('arming');
    run(b, input, 20);
    expect(b.weapons.right?.id).toBe('firebird');
  });

  it('a falling player rises again; the wave restarts at full light', () => {
    const b = new Battle();
    const input = makeInput();
    b.start(1);
    input.equip = { pose: 'dog', hand: 'right' };
    run(b, input, 7);
    expect(b.state).toBe('fight');
    b.hp = 0;
    run(b, input, 0.1);
    expect(b.state).toBe('down');
    expect(b.falls).toBe(1);
    run(b, input, 4);
    expect(b.state).toBe('fight');
    expect(b.hp).toBe(5);
  });

  it('the Moon Shield sends a shadow orb back at the wraith that threw it', () => {
    const b = new Battle();
    const input = makeInput();
    b.start(2);
    input.equip = { pose: 'rabbit', hand: 'left' };
    // The left hand holds the shield straight out in front of the face.
    const hold = () =>
      b.rigs.left.fromFrame(new Vector3(0, 1.2, -0.35), new Vector3(0, 0, -1), new Vector3(0, 1, 0), new Vector3(0, 0, -1), false, false, DT);
    run(b, input, 7, hold);
    (b as any).queue.length = 0;
    const w = new Wraith();
    w.root.position.set(0, 1.4, -4);
    w.emerge = 1;
    b.monsters.push(w);
    b.root.add(w.root);
    b.fireOrb(new Vector3(0, 1.3, -3.5), 3, false, w);
    const hpBefore = w.targets[0].hp;
    run(b, input, 3, () => {
      hold();
      w.root.position.set(0, 1.4, -4); // keep it still for the test
    });
    expect(b.hp).toBe(5);
    expect(w.targets[0].hp).toBeLessThan(hpBefore);
    expect(b.weapons.left).toBeInstanceOf(Shield);
  });

  it('the Shadow Eater keeps its broken cores when you fall', () => {
    const b = new Battle();
    const input = makeInput();
    b.start(4);
    input.equip = { pose: 'bird', hand: 'right' };
    run(b, input, 8);
    const boss = b.monsters.find((m) => m instanceof ShadowEater) as ShadowEater | undefined;
    expect(boss).toBeDefined();
    boss!.hit(boss!.chest, 99, new Vector3(0, 0, -1));
    expect(boss!.coresLeft).toBe(2);
    b.hp = 0;
    run(b, input, 5);
    expect(b.state).toBe('fight');
    expect(b.monsters.filter((m) => m instanceof ShadowEater)).toHaveLength(1);
    expect(boss!.coresLeft).toBe(2);
    // Break the rest: victory.
    for (const h of boss!.hands) boss!.hit(h, 99, new Vector3(0, 0, -1));
    run(b, input, 2);
    expect(b.state).toBe('won');
  });
});
