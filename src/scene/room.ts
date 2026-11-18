import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  CylinderGeometry,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  RepeatWrapping,
  SphereGeometry,
  SpotLight,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  Vector3,
} from '@iwsdk/core';
import { CANDLE_FLAME, EYE_Y, WALL_Z } from './layout.js';

/** Deterministic value noise so the room looks identical on every load. */
function makeRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Canvas-generated stone. `plain` gives the smooth plaster-like shadow wall,
 * otherwise rough blocks for the surrounding room.
 */
function stoneTexture(
  base: [number, number, number],
  plain: boolean,
  seed: number,
): CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const rand = makeRng(seed);

  // Coarse noise lattice for blotchy variation, bilinearly sampled.
  const grid = 16;
  const lattice = new Float32Array((grid + 1) * (grid + 1));
  for (let i = 0; i < lattice.length; i++) lattice[i] = rand();
  const sample = (x: number, y: number) => {
    const gx = (x / size) * grid;
    const gy = (y / size) * grid;
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const fx = gx - x0;
    const fy = gy - y0;
    const i = y0 * (grid + 1) + x0;
    const a = lattice[i] + (lattice[i + 1] - lattice[i]) * fx;
    const b =
      lattice[i + grid + 1] + (lattice[i + grid + 2] - lattice[i + grid + 1]) * fx;
    return a + (b - a) * fy;
  };

  const brickH = plain ? 128 : 64;
  const brickW = plain ? 256 : 128;
  for (let y = 0; y < size; y++) {
    const row = Math.floor(y / brickH);
    const offset = row % 2 ? brickW / 2 : 0;
    for (let x = 0; x < size; x++) {
      const blotch = sample(x, y);
      const grain = rand();
      let v = 0.78 + blotch * 0.3 + grain * (plain ? 0.08 : 0.16);
      const bx = (x + offset) % brickW;
      const by = y % brickH;
      const mortar = bx < 3 || by < 3;
      if (mortar) v *= plain ? 0.92 : 0.55;
      const p = (y * size + x) * 4;
      img.data[p] = Math.min(255, base[0] * v);
      img.data[p + 1] = Math.min(255, base[1] * v);
      img.data[p + 2] = Math.min(255, base[2] * v);
      img.data[p + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

function glowTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,220,150,1)');
  g.addColorStop(0.25, 'rgba(255,160,70,0.45)');
  g.addColorStop(1, 'rgba(255,120,40,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

/**
 * The candle-lit stone room. One SpotLight at the candle flame is the only
 * shadow caster in the scene (keeps Quest at 72 fps); a dim hemisphere light
 * keeps the shadows warm-dark rather than pitch black.
 */
export class Room {
  readonly root = new Group();
  /** Stone floor, side walls and ceiling: shown only in the Shadow Theatre. */
  readonly shell = new Group();
  /** The shadow wall's material, tinted per world. */
  wallMaterial!: MeshStandardMaterial;
  readonly light: SpotLight;
  /** Candle light position in room-local space (constant). */
  readonly lightPos = CANDLE_FLAME.clone();
  /** The shadow wall itself (it sinks away for battles). */
  wallMesh!: Mesh;

  private readonly flame: Mesh;
  private readonly flameCore: Mesh;
  private readonly glow: Sprite;
  private readonly ambient: HemisphereLight;
  private baseIntensity = 7;
  private ambientBase = 0.35;
  private brightness = 1;
  private targetBrightness = 1;
  private t = 0;

  constructor() {
    this.root.name = 'ShadowPlayRoom';

    // --- The shadow wall: big, plain, warm plaster stone.
    const wallTex = stoneTexture([196, 176, 150], true, 7);
    wallTex.repeat.set(2.2, 1.5);
    this.wallMaterial = new MeshStandardMaterial({ map: wallTex, roughness: 0.95, metalness: 0 });
    const wall = new Mesh(new PlaneGeometry(7, 4.5), this.wallMaterial);
    wall.position.set(0, 2.0, WALL_Z);
    wall.receiveShadow = true;
    this.root.add(wall);
    this.wallMesh = wall;

    // --- Surrounding rough stone (floor, sides, ceiling) — one shared material.
    const roughTex = stoneTexture([92, 74, 60], false, 21);
    roughTex.repeat.set(3, 2);
    const rough = new MeshStandardMaterial({ map: roughTex, roughness: 1 });
    const floor = new Mesh(new PlaneGeometry(7, 5), rough);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, WALL_Z + 2.5);
    floor.receiveShadow = true;
    this.shell.add(floor);
    for (const side of [-1, 1]) {
      const sideWall = new Mesh(new PlaneGeometry(5, 4.5), rough);
      sideWall.rotation.y = -side * (Math.PI / 2);
      sideWall.position.set(side * 2.6, 2.0, WALL_Z + 2.5);
      this.shell.add(sideWall);
    }
    const ceiling = new Mesh(new PlaneGeometry(7, 5), rough);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.set(0, 4.0, WALL_Z + 2.5);
    this.shell.add(ceiling);
    this.root.add(this.shell);

    // --- Candle on a slim iron stand at lap height.
    const iron = new MeshStandardMaterial({ color: 0x2a211b, roughness: 0.6, metalness: 0.5 });
    const waxH = 0.09;
    const waxTop = CANDLE_FLAME.y - 0.022;
    const dishY = waxTop - waxH;
    const pole = new Mesh(new CylinderGeometry(0.009, 0.014, dishY, 8), iron);
    pole.position.set(CANDLE_FLAME.x, dishY / 2, CANDLE_FLAME.z);
    const foot = new Mesh(new CylinderGeometry(0.09, 0.11, 0.025, 16), iron);
    foot.position.set(CANDLE_FLAME.x, 0.0125, CANDLE_FLAME.z);
    const dish = new Mesh(new CylinderGeometry(0.055, 0.035, 0.014, 16), iron);
    dish.position.set(CANDLE_FLAME.x, dishY, CANDLE_FLAME.z);
    const wax = new Mesh(
      new CylinderGeometry(0.021, 0.023, waxH, 14),
      new MeshStandardMaterial({
        color: 0xf2e2c4,
        roughness: 0.7,
        emissive: new Color(0xff9a40),
        emissiveIntensity: 0.25,
      }),
    );
    wax.position.set(CANDLE_FLAME.x, dishY + waxH / 2 + 0.007, CANDLE_FLAME.z);
    this.root.add(pole, foot, dish, wax);

    // Flame: outer warm teardrop + white-hot core, both unlit/additive.
    this.flame = new Mesh(
      new SphereGeometry(0.011, 10, 8),
      new MeshBasicMaterial({ color: 0xff9a30, transparent: true, opacity: 0.9, blending: AdditiveBlending, depthWrite: false }),
    );
    this.flame.scale.set(1, 2.3, 1);
    this.flameCore = new Mesh(
      new SphereGeometry(0.006, 8, 6),
      new MeshBasicMaterial({ color: 0xfff1c8 }),
    );
    this.flameCore.scale.set(1, 1.8, 1);
    this.flame.position.copy(CANDLE_FLAME);
    this.flameCore.position.copy(CANDLE_FLAME).y -= 0.004;
    this.glow = new Sprite(
      new SpriteMaterial({ map: glowTexture(), blending: AdditiveBlending, depthWrite: false, transparent: true }),
    );
    this.glow.scale.setScalar(0.22);
    this.glow.position.copy(CANDLE_FLAME);
    this.root.add(this.flame, this.flameCore, this.glow);

    // --- The one shadow-casting light.
    this.light = new SpotLight(0xffa858, this.baseIntensity, 0, 1.2, 0.85, 2);
    this.light.position.copy(CANDLE_FLAME);
    this.light.target.position.set(0, EYE_Y + 0.45, WALL_Z);
    this.light.castShadow = true;
    this.light.shadow.mapSize.set(2048, 2048);
    // Concentrate the shadow map on the central cone where the hands are: sharper hand shadows.
    this.light.shadow.focus = 0.62;
    this.light.shadow.camera.near = 0.04;
    this.light.shadow.camera.far = 5;
    this.light.shadow.bias = -0.0004;
    this.light.shadow.radius = 3;
    this.light.shadow.blurSamples = 8;
    this.root.add(this.light, this.light.target);

    this.ambient = new HemisphereLight(0x6a4630, 0x140a06, 0.35);
    this.root.add(this.ambient);
  }

  /** Re-centre the room on the player's real head so seated play works for anyone. */
  anchorTo(headWorld: Vector3): void {
    this.root.position.set(headWorld.x, headWorld.y - EYE_Y, headWorld.z);
    this.root.updateMatrixWorld(true);
  }

  /** 1 = normal candle, >1 = the triumphant ending glow. */
  setBrightness(b: number): void {
    this.targetBrightness = b;
  }

  update(dt: number): void {
    this.t += dt;
    const t = this.t;
    this.brightness += (this.targetBrightness - this.brightness) * Math.min(1, dt * 1.5);
    // Layered sines read as organic flicker without per-frame allocation.
    const flicker =
      1 +
      0.06 * Math.sin(t * 7.3) +
      0.04 * Math.sin(t * 13.1 + 1.7) +
      0.03 * Math.sin(t * 23.7 + 0.4);
    this.light.intensity = this.baseIntensity * this.brightness * flicker;
    this.ambient.intensity = this.ambientBase * (0.7 + 0.3 * this.brightness);
    const sway = 0.0012 * Math.sin(t * 5.1) + 0.0008 * Math.sin(t * 11.3);
    this.flame.position.x = CANDLE_FLAME.x + sway;
    this.flame.scale.y = 2.3 * (0.9 + 0.12 * flicker);
    this.glow.scale.setScalar(0.2 * flicker * Math.sqrt(this.brightness));
  }

  /** Adopt a world's look: wall tint and ambient light (the shell is replaced by the world). */
  setLook(look: { wallTint: number; hemiSky: number; hemiGround: number; hemiIntensity: number }): void {
    this.shell.visible = false;
    this.wallMaterial.color.set(look.wallTint);
    this.ambient.color.set(look.hemiSky);
    this.ambient.groundColor.set(look.hemiGround);
    this.ambientBase = look.hemiIntensity;
  }

  /** Room-local → world helper for objects living outside the room root. */
  addToRoom(obj: Object3D): void {
    this.root.add(obj);
  }
}
