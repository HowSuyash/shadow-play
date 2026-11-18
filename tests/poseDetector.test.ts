import { describe, expect, it } from 'vitest';
import fixtures from './fixtures/hands.json';
import { openPalmScore, palmUpScore } from '../src/hands/gestures.js';
import { HandData, type Handedness } from '../src/hands/handData.js';
import {
  birdScore,
  dogScore,
  HandFeatures,
  HoldTimer,
  POSE_CONFIG,
  PoseDetector,
  rabbitScore,
  snakeScore,
} from '../src/hands/poseDetector.js';

type Fixture = { joints: number[][]; radii: number[] };
const shapes = (fixtures as unknown as { shapes: Record<string, Partial<Record<Handedness, Fixture>>> }).shapes;

/** Real 25-joint hand captured from the IWSDK emulator's hand model. */
function hand(name: string, side: Handedness = 'right'): HandData {
  const f = shapes[name]?.[side];
  if (!f) throw new Error(`no fixture ${name}/${side}`);
  const h = new HandData(side);
  h.setJoints(f.joints.flat());
  h.radii.set(f.radii);
  return h;
}

function features(name: string, side: Handedness = 'right'): HandFeatures {
  const f = new HandFeatures(hand(name, side));
  f.update();
  return f;
}

const T = POSE_CONFIG.threshold;
const oneHanded = { dog: dogScore, rabbit: rabbitScore, snake: snakeScore };

describe('one-hand creature shapes (real joint data)', () => {
  it.each([
    ['dog', 'dog'],
    ['rabbit', 'rabbit'],
    ['snake', 'snake'],
  ] as const)('%s fixture is recognised as %s and only %s', (fixture, expected) => {
    const f = features(fixture);
    for (const [pose, score] of Object.entries(oneHanded)) {
      const c = score(f);
      if (pose === expected) expect(c, `${pose} on ${fixture}`).toBeGreaterThan(T);
      else expect(c, `${pose} on ${fixture}`).toBeLessThan(T);
    }
  });

  // Shapes people make by accident (or for the UI) must not summon creatures.
  it.each(['open', 'fist', 'point', 'thumbsup', 'four', 'call', 'relaxed', 'palmup'])(
    '%s does not trigger dog / rabbit / snake',
    (fixture) => {
      const f = features(fixture);
      for (const [pose, score] of Object.entries(oneHanded)) {
        expect(score(f), `${pose} on ${fixture}`).toBeLessThan(T);
      }
    },
  );
});

describe('two-hand bird', () => {
  it('thumbs hooked, fingers spread → bird', () => {
    expect(birdScore(features('bird', 'left'), features('bird', 'right'))).toBeGreaterThan(T);
  });
  it('two open hands held apart → not a bird', () => {
    expect(birdScore(features('apart', 'left'), features('apart', 'right'))).toBeLessThan(T);
  });
  it('needs both hands tracked', () => {
    const l = features('bird', 'left');
    const r = features('bird', 'right');
    r.tracked = false;
    expect(birdScore(l, r)).toBe(0);
  });
});

describe('UI gestures', () => {
  it('open palm toward the wall starts the game', () => {
    expect(openPalmScore(features('open'))).toBeGreaterThan(0.6);
  });
  it('a fist is not an open palm', () => {
    expect(openPalmScore(features('fist'))).toBeLessThan(0.6);
  });
  it('palm facing up is recognised (pause gesture uses two of these)', () => {
    expect(palmUpScore(features('palmup'))).toBeGreaterThan(0.6);
    expect(palmUpScore(features('open'))).toBeLessThan(0.6);
  });
});

describe('features', () => {
  it('curl is ~0 for straight fingers and high for a fist', () => {
    const open = features('open');
    const fist = features('fist');
    expect(open.fingersCurl).toBeLessThan(0.2);
    expect(fist.fingersCurl).toBeGreaterThan(0.7);
  });
  it('palm normal of a palm-forward right hand points at the wall (-Z)', () => {
    expect(features('open').palmNormal.z).toBeLessThan(-0.6);
  });
});

describe('hold-to-trigger', () => {
  it('fires once after the hold time, then needs a release', () => {
    const t = new HoldTimer(1);
    let fired = 0;
    for (let i = 0; i < 9; i++) fired += t.update(0.1, true) ? 1 : 0;
    expect(fired).toBe(0); // 0.9 s: not yet
    for (let i = 0; i < 20; i++) fired += t.update(0.1, true) ? 1 : 0;
    expect(fired).toBe(1); // exactly once while still held
    for (let i = 0; i < 10; i++) t.update(0.1, false); // release
    for (let i = 0; i < 11; i++) fired += t.update(0.1, true) ? 1 : 0;
    expect(fired).toBe(2);
  });

  it('a brief dropout drains instead of resetting (tracking glitches are forgiven)', () => {
    const t = new HoldTimer(1);
    for (let i = 0; i < 6; i++) t.update(0.1, true);
    t.update(0.05, false);
    expect(t.progress).toBeGreaterThan(0.45);
  });

  it('PoseDetector triggers DOG from real joints after ~1 s', () => {
    const left = new HandData('left');
    const right = hand('dog');
    const det = new PoseDetector(left, right);
    let triggered: string | null = null;
    let at = 0;
    for (let i = 1; i <= 15 && !triggered; i++) {
      det.updateFeatures();
      triggered = det.update(0.1, true).triggered;
      at = i * 0.1;
    }
    expect(triggered).toBe('dog');
    expect(at).toBeGreaterThanOrEqual(0.99);
    expect(at).toBeLessThan(1.25);
  });

  it('nothing charges while disabled (paused / cutscene)', () => {
    const det = new PoseDetector(new HandData('left'), hand('rabbit'));
    for (let i = 0; i < 20; i++) {
      det.updateFeatures();
      expect(det.update(0.1, false).triggered).toBeNull();
    }
  });
});
