import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { PassageLevel, ShadowEaterLevel } from '../src/game/finalLevels.js';
import { ChasmLevel, type Level, ThiefLevel, WallLevel } from '../src/game/levels.js';
import { Progress } from '../src/game/progress.js';
import type { Room } from '../src/scene/room.js';
import { Duel, randomTargets, type DuelEvent } from '../src/modes/duel.js';
import type { Hint } from '../src/ui/wallUI.js';

const room = {} as Room;
const spawn = () => new Vector3(-0.3, 1.6, -1.49);

/** Advance a level's cutscene until it settles (or a time limit passes). */
function run(level: Level, seconds = 40, dt = 1 / 30): void {
  for (let t = 0; t < seconds && (level.busy || !level.solved); t += dt) {
    level.update(dt, t);
    if (!level.busy) break;
  }
}

describe('story chapters', () => {
  it.each([
    ['I · First Light', () => new ChasmLevel(room), 'bird', 'rabbit'],
    ['II · Lost Treasure', () => new ThiefLevel(room), 'dog', 'rabbit'],
    ['III · Underground', () => new WallLevel(room), 'rabbit', 'bird'],
  ] as const)('%s: both branches solve it, with different story lines', (_n, make, a, b) => {
    const lines = new Set<string>();
    for (const pose of [a, b]) {
      const level = make();
      level.enter();
      expect(level.summon(pose, spawn())).toBe(true);
      run(level);
      expect(level.solved).toBe(true);
      expect(level.outcome).toBe(pose);
      lines.add(level.storyLine());
    }
    expect(lines.size).toBe(2);
  });

  it('a creature that does not fit plays the puzzled reaction and does not solve', () => {
    const level = new ThiefLevel(room);
    level.enter();
    expect(level.summon('snake', spawn())).toBe(false);
    run(level);
    expect(level.solved).toBe(false);
    expect(level.busy).toBe(false);
  });

  it('IV · Forbidden Passage is solved by the snake only', () => {
    const level = new PassageLevel(room);
    level.enter();
    expect(level.summon('dog', spawn())).toBe(false);
    run(level);
    expect(level.summon('snake', spawn())).toBe(true);
    run(level);
    expect(level.solved).toBe(true);
  });

  it('re-entering a chapter resets it', () => {
    const level = new ChasmLevel(room);
    level.enter();
    level.summon('bird', spawn());
    run(level);
    expect(level.solved).toBe(true);
    level.enter();
    expect(level.solved).toBe(false);
    expect(level.outcome).toBeNull();
  });
});

describe('V · The Shadow Eater (boss)', () => {
  it('solo: four seals, in order dog → bird → rabbit → snake', () => {
    const boss = new ShadowEaterLevel(room);
    boss.enter();
    expect(boss.solutions).toEqual(['dog']);
    expect(boss.summon('bird', spawn())).toBe(false); // out of order
    run(boss);
    for (const p of ['dog', 'bird', 'rabbit', 'snake'] as const) {
      expect(boss.solutions).toEqual([p]);
      expect(boss.summon(p, spawn())).toBe(true);
      run(boss);
    }
    expect(boss.solved).toBe(true);
  });

  it('co-op: two players with the next two creatures break two seals at once', () => {
    const boss = new ShadowEaterLevel(room);
    boss.enter();
    expect(boss.summon('dog', spawn(), false, 'bird')).toBe(true);
    run(boss);
    expect(boss.solutions).toEqual(['rabbit']);
    // Partner holds the needed one while the host holds the next: still works.
    expect(boss.summon('snake', spawn(), false, 'rabbit')).toBe(true);
    run(boss);
    expect(boss.solved).toBe(true);
  });
});

describe('Shadow Duel (host-authoritative)', () => {
  const hint = { show: () => {} } as unknown as Hint;

  function pair() {
    const toGuest: DuelEvent[] = [];
    const toHost: DuelEvent[] = [];
    const host = new Duel(hint, 'host', true, (e) => toGuest.push(e));
    const guest = new Duel(hint, 'guest', true, (e) => toHost.push(e));
    const flush = () => {
      while (toGuest.length || toHost.length) {
        for (const e of toGuest.splice(0)) guest.onEvent(e);
        for (const e of toHost.splice(0)) host.onEvent(e);
      }
    };
    return { host, guest, flush };
  }

  const step = (d: Duel, seconds: number) => {
    for (let t = 0; t < seconds; t += 0.1) d.update(0.1, t);
  };

  it('guest receives the same creatures the host dealt', () => {
    const { host, guest, flush } = pair();
    host.begin();
    flush();
    expect(guest.targets).toEqual(host.targets);
    expect(guest.open).toBe(true);
  });

  it('host rejects a guest claim with the wrong creature or the wrong round', () => {
    const { host, guest, flush } = pair();
    host.begin();
    flush();
    const target = host.targets[0];
    const wrong = (['dog', 'bird', 'rabbit', 'snake'] as const).find((p) => p !== target)!;
    host.onEvent({ t: 'duel', op: 'hit', i: 0, pose: wrong });
    host.onEvent({ t: 'duel', op: 'hit', i: 3, pose: target });
    expect(host.score.guest).toBe(0);
    guest.localHit(target);
    flush();
    expect(host.score.guest).toBe(1);
    expect(guest.score.guest).toBe(1);
  });

  it('only the first correct hit scores a round', () => {
    const { host, guest, flush } = pair();
    host.begin();
    flush();
    const target = host.targets[0];
    host.localHit(target);
    guest.localHit(target);
    flush();
    expect(host.score).toEqual({ host: 1, guest: 0 });
    expect(guest.score).toEqual({ host: 1, guest: 0 });
  });

  it('a match lasts five rounds and declares the winner', () => {
    const { host, guest, flush } = pair();
    host.begin();
    flush();
    for (let r = 0; r < 5; r++) {
      host.localHit(host.targets[r]);
      flush();
      step(host, 3);
      step(guest, 3);
    }
    expect(host.done).toBe(true);
    expect(guest.done).toBe(true);
    expect(host.localWon).toBe(true);
    expect(guest.localWon).toBe(false);
  });

  it('random targets never repeat back-to-back', () => {
    for (let k = 0; k < 50; k++) {
      const t = randomTargets();
      expect(t).toHaveLength(5);
      for (let i = 1; i < t.length; i++) expect(t[i]).not.toBe(t[i - 1]);
    }
  });
});

describe('progress', () => {
  it('stars reward no hints and speed', () => {
    expect(Progress.starsFor(20, 0)).toBe(3);
    expect(Progress.starsFor(80, 0)).toBe(2);
    expect(Progress.starsFor(20, 1)).toBe(1);
  });
  it('unlocks creatures and earns achievements once (storage optional)', () => {
    const p = new Progress();
    for (const c of ['dog', 'bird', 'rabbit', 'snake'] as const) p.unlock(c);
    p.unlock('dog');
    expect(p.data.unlocked).toEqual(['dog', 'bird', 'rabbit', 'snake']);
    expect(p.takeNew()).toEqual(['first_shadow', 'all_four']);
    expect(p.takeNew()).toEqual([]);
  });
});

describe('Shadow Memory', async () => {
  const { Memory } = await import('../src/modes/memory.js');
  const hint = { show: () => {} } as unknown as Hint;
  const step = (m: InstanceType<typeof Memory>, seconds: number) => {
    for (let t = 0; t < seconds; t += 0.05) m.update(0.05, t);
  };

  it('shows the sequence, then listens; a correct run grows it by one', () => {
    const m = new Memory(hint);
    m.start();
    expect(m.phase).toBe('show');
    expect(m.seq).toHaveLength(3);
    step(m, 6);
    expect(m.listening).toBe(true);
    for (const p of [...m.seq]) expect(m.onPose(p)).toBe(true);
    expect(m.best).toBe(3);
    step(m, 2.5);
    expect(m.seq).toHaveLength(4);
    expect(m.phase).toBe('show');
  });

  it('a wrong shape costs a life and replays; three mistakes end the game', () => {
    const m = new Memory(hint);
    m.start();
    for (let k = 0; k < 3; k++) {
      step(m, 7);
      expect(m.listening).toBe(true);
      const wrong = (['dog', 'bird', 'rabbit', 'snake'] as const).find((p) => p !== m.seq[0])!;
      expect(m.onPose(wrong)).toBe(false);
    }
    expect(m.lives).toBe(0);
    expect(m.phase).toBe('done');
  });

  it('ignores shapes while the sequence is being shown', () => {
    const m = new Memory(hint);
    m.start();
    expect(m.onPose(m.seq[0])).toBe(false);
    expect(m.lives).toBe(3);
  });
});
