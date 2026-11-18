import { Group, Mesh, MeshBasicMaterial } from '@iwsdk/core';
import type { PoseId } from '../hands/poseDetector.js';
import { STAGE } from '../scene/layout.js';
import { Bird, Dog, Rabbit, Snake, type Silhouette } from '../game/creatures.js';
import { makeGround } from '../game/levels.js';
import { ACHIEVEMENTS, type Progress } from '../game/progress.js';
import { makeText } from './wallUI.js';

const INFO: Record<PoseId, { name: string; ability: string; how: string }> = {
  dog: { name: 'Dog', ability: 'barks · chases · guards', how: 'flat hand · thumb up · pinky down' },
  bird: { name: 'Bird', ability: 'flies over gaps and walls', how: 'hook both thumbs · spread fingers' },
  rabbit: { name: 'Rabbit', ability: 'digs tunnels · leaps', how: 'two fingers up · curl the rest' },
  snake: { name: 'Snake', ability: 'slips through cracks', how: 'fingers together · thumb tucked' },
};

/** The Creature Gallery: every creature alive on the wall, with its story stats. */
export class Gallery {
  readonly root = new Group();
  private readonly creatures: Record<PoseId, Silhouette> = {
    dog: new Dog(),
    bird: new Bird(),
    rabbit: new Rabbit(),
    snake: new Snake(),
  };
  private readonly order: PoseId[] = ['dog', 'bird', 'rabbit', 'snake'];
  private texts: Mesh[] = [];

  constructor() {
    this.root.position.z = STAGE.z;
    this.root.visible = false;
    this.root.add(makeGround());
    this.order.forEach((p, i) => {
      const c = this.creatures[p];
      const x = -0.95 + i * 0.63;
      c.root.position.set(x - (p === 'snake' ? -0.2 : 0), STAGE.groundY + (p === 'bird' ? 0.32 : 0), 0.002);
      c.facing = 1;
      this.root.add(c.root);
    });
    (this.creatures.bird as Bird).flapping = true;
  }

  show(progress: Progress): void {
    for (const t of this.texts) {
      t.removeFromParent();
      (t.material as MeshBasicMaterial).map?.dispose();
    }
    this.texts = [];
    const add = (m: Mesh, x: number, y: number) => {
      m.position.set(x, y, 0.004);
      this.root.add(m);
      this.texts.push(m);
    };
    add(makeText(['Creature Gallery'], 0.17, { size: 80, letterSpacing: 4 }), 0, STAGE.titleY + 0.2);
    this.order.forEach((p, i) => {
      const x = -0.95 + i * 0.63;
      const open = progress.isUnlocked(p);
      this.creatures[p].fade(open ? 1 : 0.18, true);
      const info = INFO[p];
      add(
        makeText(open ? [info.name, info.ability] : ['? ? ?', 'summon it in the story'], 0.13, { size: 50, italic: !open }),
        x,
        STAGE.groundY + 0.58,
      );
      add(makeText([info.how], 0.06, { size: 44, italic: true, color: '#e8c48f' }), x, STAGE.groundY - 0.08);
    });
    const d = progress.data;
    const stars = ['I', 'II', 'III', 'IV', 'V']
      .map((n) => `${n} ${'★'.repeat(d.stars[n] ?? 0)}${'☆'.repeat(3 - (d.stars[n] ?? 0))}`)
      .join('   ');
    const best = d.bestRun === null ? '—' : `${Math.floor(d.bestRun / 60)}:${String(Math.round(d.bestRun % 60)).padStart(2, '0')}`;
    add(makeText([stars, `best story ${best}  ·  duels won ${d.duelWins} / ${d.duelPlayed}`], 0.12, { size: 50 }), 0, STAGE.titleY + 0.03);
    const earned = Object.entries(ACHIEVEMENTS)
      .map(([id, a]) => (d.achievements.includes(id) ? `✦ ${a.title}` : '· ? ·'))
      .join('   ');
    add(makeText([earned], 0.06, { size: 44, color: '#ffe9c4' }), 0, STAGE.groundY - 0.2);
    this.root.visible = true;
  }

  hide(): void {
    this.root.visible = false;
  }

  update(dt: number, time: number): void {
    if (!this.root.visible) return;
    for (const p of this.order) this.creatures[p].update(dt, time);
    (this.creatures.snake as Snake).rear = 0.5 + 0.3 * Math.sin(time * 1.2);
  }
}
