import { Color, createSystem, Vector3, VisibilityState, World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { HandTracker } from './hands/handData.js';
import { HandShadowCasters } from './hands/shadows.js';
import { Room } from './scene/room.js';

/** Everything the per-frame system needs, created once at boot. */
interface Runtime {
  world: World;
  room: Room;
  hands: HandTracker;
  casters: HandShadowCasters;
}

let rt: Runtime | undefined;

class ShadowPlaySystem extends createSystem({}) {
  private head = new Vector3();
  private anchoredSession: XRSession | undefined;
  private anchorFrames = 0;

  update(delta: number): void {
    if (!rt) return;
    const dt = Math.min(delta, 0.1);
    this.anchorRoom();
    rt.hands.update(rt.world, rt.room.root);
    rt.casters.update([rt.hands.left, rt.hands.right]);
    rt.room.update(dt);
  }

  /** Once per XR session, centre the room on the player's actual head. */
  private anchorRoom(): void {
    const session = rt!.world.session;
    if (!session) {
      this.anchoredSession = undefined;
      return;
    }
    if (this.anchoredSession === session) return;
    // Wait a few frames so the viewer pose is valid.
    if (++this.anchorFrames < 5) return;
    this.anchorFrames = 0;
    rt!.world.player.head.getWorldPosition(this.head);
    if (this.head.lengthSq() === 0) return;
    rt!.room.anchorTo(this.head);
    this.anchoredSession = session;
  }
}

function setupEnterButton(world: World): void {
  const button = document.getElementById('enter-vr') as HTMLButtonElement | null;
  if (!button) return;
  if (!world.xrEnabled) return;
  button.hidden = false;
  button.addEventListener('click', () => world.launchXR());
  world.visibilityState.subscribe((state) => {
    button.hidden = state !== VisibilityState.NonImmersive;
  });
}

World.create(
  document.getElementById('scene-container') as HTMLDivElement,
  projectOptions,
).then((world) => {
  world.scene.background = new Color(0x050302);
  world.renderer.shadowMap.enabled = true;

  const room = new Room();
  const casters = new HandShadowCasters();
  room.root.add(casters.root);
  world.createTransformEntity(room.root, { persistent: true });

  rt = { world, room, hands: new HandTracker(), casters };
  world.registerSystem(ShadowPlaySystem);
  setupEnterButton(world);
});
