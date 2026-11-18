import type { PoseId } from '../hands/poseDetector.js';

/**
 * Cosmetic progression, saved per device in localStorage. Nothing here
 * changes gameplay; it only feeds the Creature Gallery and the end screens.
 * Every access is wrapped: private windows or blocked storage just mean
 * progress lasts for this session only.
 */
export interface ProgressData {
  unlocked: PoseId[];
  /** Best stars (1–3) per chapter numeral. */
  stars: Record<string, number>;
  /** Fastest full story run, seconds. */
  bestRun: number | null;
  duelWins: number;
  duelPlayed: number;
  achievements: string[];
}

export const ACHIEVEMENTS: Record<string, { title: string; text: string }> = {
  first_shadow: { title: 'First Shadow', text: 'Bring a shadow to life.' },
  storyteller: { title: 'Storyteller', text: 'Finish the story.' },
  kind_heart: { title: 'Kind Heart', text: 'Befriend the thief.' },
  all_four: { title: 'Menagerie', text: 'Summon all four creatures.' },
  duet: { title: 'Shadow Duet', text: 'Summon a giant creature with a friend.' },
  swift: { title: 'Swift Hands', text: 'Finish the story in under 4 minutes.' },
  duelist: { title: 'Duelist', text: 'Win a Shadow Duel.' },
  flawless: { title: 'Flawless', text: 'Earn three stars on every chapter.' },
};

const KEY = 'shadow-play-progress-v1';

function blank(): ProgressData {
  return { unlocked: [], stars: {}, bestRun: null, duelWins: 0, duelPlayed: 0, achievements: [] };
}

export class Progress {
  data: ProgressData = blank();
  /** Achievements earned since the last call to takeNew(). */
  private fresh: string[] = [];

  constructor() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this.data = { ...blank(), ...(JSON.parse(raw) as Partial<ProgressData>) };
    } catch {
      this.data = blank();
    }
  }

  private save(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* storage unavailable: progress lasts for this session */
    }
  }

  isUnlocked(p: PoseId): boolean {
    return this.data.unlocked.includes(p);
  }

  unlock(p: PoseId): void {
    if (!this.isUnlocked(p)) this.data.unlocked.push(p);
    this.award('first_shadow');
    if (this.data.unlocked.length >= 4) this.award('all_four');
    this.save();
  }

  /** Stars: 3 = no hint and under 40 s, 2 = no hint, 1 = solved. */
  static starsFor(seconds: number, hintsUsed: number): number {
    if (hintsUsed === 0 && seconds < 40) return 3;
    return hintsUsed === 0 ? 2 : 1;
  }

  recordChapter(numeral: string, stars: number): void {
    this.data.stars[numeral] = Math.max(this.data.stars[numeral] ?? 0, stars);
    const all = ['I', 'II', 'III', 'IV', 'V'];
    if (all.every((n) => (this.data.stars[n] ?? 0) >= 3)) this.award('flawless');
    this.save();
  }

  recordRun(seconds: number): void {
    this.data.bestRun = this.data.bestRun === null ? seconds : Math.min(this.data.bestRun, seconds);
    this.award('storyteller');
    if (seconds < 240) this.award('swift');
    this.save();
  }

  recordDuel(won: boolean): void {
    this.data.duelPlayed++;
    if (won) {
      this.data.duelWins++;
      this.award('duelist');
    }
    this.save();
  }

  award(id: string): void {
    if (!ACHIEVEMENTS[id] || this.data.achievements.includes(id)) return;
    this.data.achievements.push(id);
    this.fresh.push(id);
    this.save();
  }

  /** Newly earned achievements (cleared once read) for a little toast. */
  takeNew(): string[] {
    const f = this.fresh;
    this.fresh = [];
    return f;
  }
}
