import { Color, Group, Mesh, MeshBasicMaterial, PMREMGenerator, Scene, SphereGeometry, type Texture, type Vector3, type WebGLRenderer } from '@iwsdk/core';
import { castle } from './envs/castle.js';
import { forest } from './envs/forest.js';
import type { WorldId, WorldLook, WorldSet } from './envs/kit.js';
import { realm } from './envs/realm.js';
import { sky } from './envs/sky.js';
import { theatre } from './envs/theatre.js';

export type { WorldId, WorldLook };

/**
 * The five worlds of Shadow Play: full 360° procedural 3D surroundings built
 * around the seated player and the shadow wall (see ./envs/). Everything is
 * generated in code (no downloads), merged into a few draw calls per world with
 * lighting baked into vertex colours, and only the active world is visible.
 *
 * Art direction: warm gold = magic, deep navy = darkness, violet = the Shadow
 * Eater's corruption. The Shadow Theatre is an ancient Indian shadow-puppetry
 * temple (Tholu Bommalata / Tholpavakoothu traditions) and the game's home.
 */

const BUILDERS: Record<WorldId, () => WorldSet> = { theatre, forest, castle, sky, realm };

/** Owns the five worlds; builds each lazily the first time it's visited. */
export class Worlds {
  readonly root = new Group();
  current: WorldId | null = null;
  private readonly sets = new Map<WorldId, WorldSet>();
  private pmrem: PMREMGenerator | undefined;

  constructor(private readonly renderer?: WebGLRenderer) {}

  /** A tiny scene of glowing spots → prefiltered reflection map (brass gleams, floors shine). */
  private envFor(w: WorldSet): Texture | null {
    if (!this.renderer || !w.envLights) return null;
    this.pmrem ??= new PMREMGenerator(this.renderer);
    const sc = new Scene();
    sc.background = new Color(w.look.hemiGround).lerp(new Color(w.look.hemiSky), 0.35);
    for (const [x, y, z, color, k] of w.envLights) {
      const ball = new Mesh(new SphereGeometry(1.2, 12, 8), new MeshBasicMaterial({ color: new Color(color).multiplyScalar(k) }));
      ball.position.set(x, y, z);
      sc.add(ball);
    }
    const tex = this.pmrem.fromScene(sc, 0.04).texture;
    sc.traverse((o) => (o as Mesh).geometry?.dispose());
    return tex;
  }

  /** Switch worlds (call while the screen is faded). Returns the new look. */
  set(id: WorldId): WorldLook {
    let w = this.sets.get(id);
    if (!w) {
      w = BUILDERS[id]();
      w.look.env = this.envFor(w);
      this.sets.set(id, w);
      this.root.add(w.root);
    }
    for (const [k, s] of this.sets) s.root.visible = k === id;
    this.current = id;
    return w.look;
  }

  react(): void {
    if (this.current) this.sets.get(this.current)?.react();
  }

  update(dt: number, t: number, hands: Vector3[]): void {
    if (this.current) this.sets.get(this.current)?.update(dt, t, hands);
  }
}
