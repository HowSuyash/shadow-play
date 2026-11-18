import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  DoubleSide,
  Float32BufferAttribute,
  FogExp2,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  PMREMGenerator,
  PointLight,
  Scene,
  type Texture,
  type WebGLRenderer,
  Points,
  PointsMaterial,
  Quaternion,
  RepeatWrapping,
  ShaderMaterial,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
} from '@iwsdk/core';
import { EYE_Y, WALL_Z } from './layout.js';

/**
 * The five worlds of Shadow Play: full 360° procedural 3D surroundings built
 * around the seated player and the shadow wall. Everything is generated in
 * code (no downloads), instanced where repeated, lit by cheap non-shadow
 * lights, and only the active world is visible.
 *
 * Art direction: warm gold = magic, deep navy = darkness, violet = the Shadow
 * Eater's corruption. The Shadow Theatre is an ancient Indian shadow-puppetry
 * temple (Tholu Bommalata / tholpavakoothu traditions) and the game's home.
 */
export type WorldId = 'theatre' | 'forest' | 'castle' | 'sky' | 'realm';

export interface WorldLook {
  /** Shadow-wall tint (must stay light enough for hand shadows to read). */
  wallTint: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  fog: FogExp2 | null;
  /** Image-based lighting for reflections (filled in by Worlds.set). */
  env?: Texture | null;
}

interface WorldSet {
  root: Group;
  look: WorldLook;
  /** Bright spots baked into this world's reflection map: [x, y, z, color, strength]. */
  envLights?: [number, number, number, number, number][];
  update(dt: number, t: number, hands: Vector3[]): void;
  /** Something magical happened (a creature appeared): react to it. */
  react(): void;
}

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Gradient sky sphere: top → horizon → bottom. */
function dome(top: number, horizon: number, bottom: number, radius = 60): Mesh {
  const m = new Mesh(
    new SphereGeometry(radius, 32, 16),
    new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { uTop: { value: new Color(top) }, uMid: { value: new Color(horizon) }, uBot: { value: new Color(bottom) } },
      vertexShader: /* glsl */ `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: /* glsl */ `varying vec3 vP; uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uBot;
        void main(){ float h = vP.y; vec3 c = h > 0.0 ? mix(uMid, uTop, pow(h, 0.6)) : mix(uMid, uBot, pow(-h, 0.5)); gl_FragColor = vec4(c,1.0); }`,
    }),
  );
  m.renderOrder = -10;
  m.position.y = EYE_Y;
  return m;
}

/** Canvas noise texture for stone, bark, moss… */
function noiseTex(base: [number, number, number], vary: number, seed: number, lines?: (ctx: CanvasRenderingContext2D) => void): CanvasTexture {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const r = rng(seed);
  for (let i = 0; i < size * size; i++) {
    const v = 1 - vary / 2 + r() * vary;
    img.data[i * 4] = base[0] * v;
    img.data[i * 4 + 1] = base[1] * v;
    img.data[i * 4 + 2] = base[2] * v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  lines?.(ctx);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}

let softTex: CanvasTexture | undefined;
function soft(): CanvasTexture {
  if (!softTex) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.3, 'rgba(255,255,255,0.6)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    softTex = new CanvasTexture(c);
  }
  return softTex;
}

/** One Points draw call for many glowing things (flames, fireflies, motes, clouds). */
function glowPoints(positions: number[], color: number, size: number, opacity = 1, additive = true): Points {
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
  const p = new Points(
    geo,
    new PointsMaterial({
      map: soft(),
      color,
      size,
      sizeAttenuation: true,
      transparent: true,
      opacity,
      depthWrite: false,
      blending: additive ? AdditiveBlending : undefined,
    }),
  );
  p.frustumCulled = false;
  p.renderOrder = 2;
  return p;
}

/**
 * "Baked" lighting: scenery glows softly from its own texture so the world
 * reads clearly without extra lights (which would also wash out the hand
 * shadows on the wall). Cheap and Quest-friendly.
 */
function baked<T extends MeshStandardMaterial>(mat: T, k: number, tint?: number): T {
  mat.emissive = new Color(tint ?? 0xffffff);
  if (mat.map && tint === undefined) mat.emissiveMap = mat.map;
  else if (tint === undefined) mat.emissive.copy(mat.color);
  mat.emissiveIntensity = k;
  // Surface relief from the same noise texture: stone and bark stop looking flat.
  if (mat.map) {
    mat.bumpMap = mat.map;
    mat.bumpScale = 1.2;
  }
  return mat;
}

/** A soft beam of light (god ray) from `from` to `to`. Additive, no depth writes. */
let shaftTex: CanvasTexture | undefined;
function lightShaft(from: Vector3, to: Vector3, r0: number, r1: number, color: number, opacity: number): Mesh {
  if (!shaftTex) {
    const c = document.createElement('canvas');
    c.width = 4;
    c.height = 128;
    const ctx = c.getContext('2d')!;
    const g = ctx.createLinearGradient(0, 0, 0, 128);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.2, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.75, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 4, 128);
    shaftTex = new CanvasTexture(c);
  }
  const dir = new Vector3().subVectors(to, from);
  const len = dir.length();
  const m = new Mesh(
    new CylinderGeometry(r0, r1, len, 20, 1, true),
    new MeshBasicMaterial({ color, map: shaftTex, transparent: true, opacity, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, fog: false }),
  );
  m.position.addVectors(from, to).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new Vector3(0, -1, 0), dir.normalize());
  m.renderOrder = 3;
  return m;
}

/** A real (non-shadow) light pool. */
function lamp(color: number, intensity: number, distance: number, x: number, y: number, z: number): PointLight {
  const l = new PointLight(color, intensity, distance, 2);
  l.position.set(x, y, z);
  return l;
}

const tmpM = new Matrix4();
const tmpQ = new Quaternion();
const tmpS = new Vector3();
const tmpP = new Vector3();
const UP = new Vector3(0, 1, 0);

function placeAll(mesh: InstancedMesh, list: { p: Vector3; s: Vector3; ry?: number; rz?: number }[]): void {
  list.forEach((it, i) => {
    tmpQ.setFromAxisAngle(UP, it.ry ?? 0);
    if (it.rz) tmpQ.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), it.rz));
    tmpM.compose(it.p, tmpQ, it.s);
    mesh.setMatrixAt(i, tmpM);
  });
  mesh.instanceMatrix.needsUpdate = true;
}

/** Keep scenery out of the play space (player + reach + the shadow wall). */
function clear(x: number, z: number): boolean {
  if (Math.hypot(x, z) < 1.6) return false; // around the player
  if (z < WALL_Z + 0.4 && z > WALL_Z - 2.2 && Math.abs(x) < 3.9) return false; // in front of / just behind the wall
  return true;
}

// ---------------------------------------------------------------------------
// A. SHADOW THEATRE — an ancient Indian shadow-puppetry temple
// ---------------------------------------------------------------------------

function theatre(): WorldSet {
  const root = new Group();
  const stone = baked(new MeshStandardMaterial({ map: noiseTex([96, 74, 56], 0.35, 3), roughness: 0.92, color: 0xb59a80 }), 0.55);
  const darkStone = baked(new MeshStandardMaterial({ map: noiseTex([60, 46, 38], 0.3, 4), roughness: 0.95 }), 0.45);
  const brass = new MeshStandardMaterial({ color: 0xc8963c, metalness: 0.6, roughness: 0.35, emissive: 0x8a5a18, emissiveIntensity: 0.9 });

  root.add(dome(0x03050d, 0x0c1426, 0x020306));

  // Polished floor with a golden rangoli at its heart.
  const floorTex = noiseTex([40, 30, 26], 0.25, 9, (ctx) => {
    ctx.translate(128, 128);
    ctx.strokeStyle = 'rgba(230,170,70,0.55)';
    ctx.lineWidth = 2;
    for (let ring = 1; ring <= 4; ring++) {
      ctx.beginPath();
      ctx.arc(0, 0, ring * 26, 0, Math.PI * 2);
      ctx.stroke();
      for (let k = 0; k < 8 * ring; k++) {
        const a = (k / (8 * ring)) * Math.PI * 2;
        ctx.beginPath();
        ctx.ellipse(Math.cos(a) * ring * 26, Math.sin(a) * ring * 26, 9, 4, a, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  });
  const floor = new Mesh(new PlaneGeometry(16, 16), baked(new MeshStandardMaterial({ map: floorTex, roughness: 0.4, metalness: 0.2 }), 0.6));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0.002, 1.5);
  root.add(floor);

  // Carved temple pillars: plinth, fluted shaft, brass bands, bracket capital.
  const pillarSpots = [
    [-3.1, -0.6], [3.1, -0.6], [-3.3, 1.6], [3.3, 1.6], [-3.3, 3.8], [3.3, 3.8], [-1.4, 5.2], [1.4, 5.2],
  ];
  const n = pillarSpots.length;
  const plinth = new InstancedMesh(new BoxGeometry(1, 1, 1), stone, n);
  const shaft = new InstancedMesh(new CylinderGeometry(0.28, 0.32, 1, 20), stone, n);
  const bands = new InstancedMesh(new TorusGeometry(0.33, 0.045, 6, 16), brass, n * 3);
  const capital = new InstancedMesh(new BoxGeometry(1, 1, 1), stone, n);
  pillarSpots.forEach(([x, z], i) => {
    plinth.setMatrixAt(i, tmpM.compose(tmpP.set(x, 0.35, z), tmpQ.identity(), tmpS.set(0.95, 0.7, 0.95)));
    shaft.setMatrixAt(i, tmpM.compose(tmpP.set(x, 0.7 + 2.6, z), tmpQ.identity(), tmpS.set(1, 5.2, 1)));
    capital.setMatrixAt(i, tmpM.compose(tmpP.set(x, 6.1, z), tmpQ.identity(), tmpS.set(1.1, 0.5, 1.1)));
    for (let b = 0; b < 3; b++) {
      bands.setMatrixAt(i * 3 + b, tmpM.compose(tmpP.set(x, 1.3 + b * 1.9, z), tmpQ.setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2), tmpS.set(1, 1, 1)));
    }
  });
  for (const m of [plinth, shaft, bands, capital]) {
    m.instanceMatrix.needsUpdate = true;
    root.add(m);
  }
  // Heavy stone beams overhead tie the hall together.
  const beam = new InstancedMesh(new BoxGeometry(1, 1, 1), darkStone, 4);
  placeAll(beam, [
    { p: new Vector3(-3.2, 6.45, 1.6), s: new Vector3(0.5, 0.35, 8) },
    { p: new Vector3(3.2, 6.45, 1.6), s: new Vector3(0.5, 0.35, 8) },
    { p: new Vector3(0, 6.45, 5.2), s: new Vector3(7, 0.35, 0.5) },
    { p: new Vector3(0, 6.45, -0.6), s: new Vector3(7, 0.35, 0.5) },
  ]);
  root.add(beam);

  // Gopuram: a tiered temple tower crowning the shadow wall, with flanking towers.
  const tiers = new InstancedMesh(new BoxGeometry(1, 1, 1), stone, 14);
  const tierList: { p: Vector3; s: Vector3 }[] = [];
  for (let k = 0; k < 6; k++) tierList.push({ p: new Vector3(0, 4.5 + k * 0.55, WALL_Z - 0.2), s: new Vector3(4.6 - k * 0.7, 0.5, 0.9 - k * 0.08) });
  for (const sx of [-1, 1]) for (let k = 0; k < 4; k++) tierList.push({ p: new Vector3(sx * 3.35, 0.9 + k * 1.3, WALL_Z - 0.05), s: new Vector3(1.0 - k * 0.12, 1.3, 0.8) });
  placeAll(tiers, tierList);
  root.add(tiers);
  const kalasha = new Mesh(new LatheGeometry([new Vector2(0, 0), new Vector2(0.22, 0.05), new Vector2(0.28, 0.25), new Vector2(0.12, 0.45), new Vector2(0.05, 0.75), new Vector2(0, 0.85)], 16), brass);
  kalasha.position.set(0, 7.75, WALL_Z - 0.2);
  root.add(kalasha);

  // Marigold toran garland swinging across the top of the stage.
  const marigolds = new InstancedMesh(new IcosahedronGeometry(0.045, 0), new MeshStandardMaterial({ color: 0xff9a1a, emissive: 0x7a3000, emissiveIntensity: 0.6, roughness: 0.8 }), 46);
  const garland: { p: Vector3; s: Vector3 }[] = [];
  for (let k = 0; k < 46; k++) {
    const u = k / 45;
    const x = -2.9 + u * 5.8;
    const y = 4.3 - Math.sin(u * Math.PI * 3) ** 2 * 0.28;
    garland.push({ p: new Vector3(x, y, WALL_Z + 0.08), s: new Vector3(1, 1, 1) });
  }
  placeAll(marigolds, garland);
  root.add(marigolds);

  // Tall kuthuvilakku lamps either side of the stage.
  const lampProfile = [0, 0.18, 0.04, 0.2, 0.05, 0.3, 0.03, 1.2, 0.06, 1.25, 0.03, 1.3, 0.025, 1.9, 0.2, 1.95, 0.18, 2.0, 0.03, 2.05, 0.02, 2.3, 0.05, 2.35, 0].reduce<Vector2[]>((acc, v, i, a) => {
    if (i % 2 === 0 && i + 1 < a.length) acc.push(new Vector2(v, a[i + 1]));
    return acc;
  }, []);
  const lampGeo = new LatheGeometry(lampProfile.length > 2 ? lampProfile : [new Vector2(0.1, 0), new Vector2(0.1, 2)], 14);
  const flames: number[] = [];
  for (const sx of [-1, 1]) {
    const lamp = new Mesh(lampGeo, brass);
    lamp.position.set(sx * 2.25, 0, WALL_Z + 0.35);
    root.add(lamp);
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      flames.push(sx * 2.25 + Math.cos(a) * 0.17, 2.02, WALL_Z + 0.35 + Math.sin(a) * 0.17);
    }
  }

  // Floating brass diyas drifting around the player.
  const r = rng(11);
  const diyaGeo = new LatheGeometry([new Vector2(0, 0), new Vector2(0.06, 0.005), new Vector2(0.075, 0.03), new Vector2(0.07, 0.035)], 12);
  const diyas = new InstancedMesh(diyaGeo, brass, 26);
  const diyaHome: Vector3[] = [];
  while (diyaHome.length < 26) {
    const a = r() * Math.PI * 2;
    const d = 1.3 + r() * 2.6;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d + 0.4;
    if (z < WALL_Z + 0.5) continue;
    diyaHome.push(new Vector3(x, 1.7 + r() * 1.9, z));
  }
  const diyaFlameStart = flames.length / 3;
  for (const h of diyaHome) flames.push(h.x, h.y + 0.05, h.z);
  const flamePts = glowPoints(flames, 0xffb24a, 0.13);
  const flameHalo = glowPoints(flames, 0xff8a30, 0.5, 0.22);
  root.add(diyas, flamePts, flameHalo);

  // Translucent leather shadow puppets (Tholu Bommalata) glowing on the side walls.
  const puppetShape = (): Shape[] => {
    const body = new Shape();
    body.absellipse(0, 0, 0.32, 0.55, 0, Math.PI * 2, false, 0);
    const head = new Shape();
    head.absellipse(0.05, 0.78, 0.2, 0.24, 0, Math.PI * 2, false, 0);
    const crown = new Shape([new Vector2(-0.18, 0.95), new Vector2(0.28, 0.95), new Vector2(0.18, 1.35), new Vector2(0.05, 1.12), new Vector2(-0.08, 1.38)]);
    const armL = new Shape([new Vector2(-0.3, 0.3), new Vector2(-0.85, 0.75), new Vector2(-0.8, 0.85), new Vector2(-0.22, 0.45)]);
    const armR = new Shape([new Vector2(0.3, 0.25), new Vector2(0.75, -0.25), new Vector2(0.82, -0.18), new Vector2(0.24, 0.4)]);
    const legs = new Shape([new Vector2(-0.25, -0.45), new Vector2(0.25, -0.45), new Vector2(0.4, -1.1), new Vector2(0.15, -1.1), new Vector2(0, -0.7), new Vector2(-0.15, -1.1), new Vector2(-0.4, -1.1)]);
    return [body, head, crown, armL, armR, legs];
  };
  const puppetGeo = new ShapeGeometry(puppetShape(), 6);
  const puppetColors = [0xd2632a, 0xb8402a, 0xd9952f, 0x9a3a6a];
  [-1, 1].forEach((sx, si) => {
    for (let k = 0; k < 2; k++) {
      const p = new Mesh(
        puppetGeo,
        new MeshBasicMaterial({ color: puppetColors[si * 2 + k], transparent: true, opacity: 0.62, side: DoubleSide, blending: AdditiveBlending, depthWrite: false }),
      );
      p.position.set(sx * 4.1, 2.6, 0.2 + k * 2.6);
      p.rotation.y = -sx * Math.PI / 2;
      p.scale.setScalar(1.1);
      root.add(p);
    }
  });
  // Dark temple walls behind the puppets and behind the player, with a glowing keyhole doorway.
  const walls = new InstancedMesh(new BoxGeometry(1, 1, 1), darkStone, 3);
  placeAll(walls, [
    { p: new Vector3(-4.3, 3.5, 2), s: new Vector3(0.3, 7, 9) },
    { p: new Vector3(4.3, 3.5, 2), s: new Vector3(0.3, 7, 9) },
    { p: new Vector3(0, 3.5, 6.4), s: new Vector3(9, 7, 0.3) },
  ]);
  root.add(walls);
  const keyhole = new Mesh(
    new ShapeGeometry(
      (() => {
        const s = new Shape();
        s.moveTo(-0.55, 0);
        s.lineTo(0.55, 0);
        s.lineTo(0.55, 2.2);
        s.absarc(0, 2.2, 0.55, 0, Math.PI, false);
        s.lineTo(-0.55, 0);
        return s;
      })(),
      12,
    ),
    new MeshBasicMaterial({ color: 0xdbe8ff, transparent: true, opacity: 0.95 }),
  );
  keyhole.position.set(0, 0, 6.24);
  keyhole.rotation.y = Math.PI;
  root.add(keyhole);
  const doorGlow = glowPoints([0, 1.6, 6.0], 0x9ec4ff, 3.6, 0.55);
  // Stone steps rising to the doorway, lined with rows of candles.
  const steps = new InstancedMesh(new BoxGeometry(1, 1, 1), stone, 6);
  const stepList: { p: Vector3; s: Vector3 }[] = [];
  for (let k = 0; k < 6; k++) stepList.push({ p: new Vector3(0, 0.08 + k * 0.16, 4.75 + k * 0.26), s: new Vector3(3.4 - k * 0.12, 0.16 + k * 0.32, 0.3) });
  placeAll(steps, stepList);
  root.add(steps);
  const wax = new MeshStandardMaterial({ color: 0xf4e6c8, roughness: 0.6, emissive: 0x6a4a20, emissiveIntensity: 0.6 });
  const candleSpots: Vector3[] = [];
  for (let k = 0; k < 6; k++) {
    for (const sx of [-1, 1]) {
      for (let c = 0; c < 3; c++) candleSpots.push(new Vector3(sx * (0.75 + c * 0.32 - k * 0.04), 0.16 + k * 0.32 + 0.0, 4.72 + k * 0.26));
    }
  }
  // More candles clustered at the foot of the pillars.
  for (const [px, pz] of pillarSpots) for (let c = 0; c < 4; c++) candleSpots.push(new Vector3(px + (c % 2 ? 0.55 : -0.55) * (c < 2 ? 1 : 0.6), 0, pz + (c < 2 ? 0.5 : -0.5)));
  const candles = new InstancedMesh(new CylinderGeometry(0.025, 0.028, 1, 8), wax, candleSpots.length);
  const candleFlames: number[] = [];
  candleSpots.forEach((c, i) => {
    const h = 0.08 + ((i * 37) % 10) * 0.012;
    candles.setMatrixAt(i, tmpM.compose(tmpP.set(c.x, c.y + h / 2, c.z), tmpQ.identity(), tmpS.set(1, h, 1)));
    candleFlames.push(c.x, c.y + h + 0.02, c.z);
  });
  candles.instanceMatrix.needsUpdate = true;
  const candleGlow = glowPoints(candleFlames, 0xffa23a, 0.11);
  const candleHalo = glowPoints(candleFlames, 0xff7a20, 0.45, 0.25);
  root.add(candles, candleGlow, candleHalo);
  // Cool moonlight pouring through the keyhole and down from an opening above the stage.
  root.add(
    lightShaft(new Vector3(0, 1.7, 6.1), new Vector3(0, 0.0, 2.2), 0.45, 1.5, 0x9ec4ff, 0.14),
    lightShaft(new Vector3(0, 9, -0.2), new Vector3(0, 0, -0.9), 0.4, 1.8, 0xffd9a0, 0.07),
  );
  // Warm light pooling from the great lamps and the stage candle.
  root.add(lamp(0xffa64a, 5, 7, -2.25, 2.1, WALL_Z + 0.6), lamp(0xffa64a, 5, 7, 2.25, 2.1, WALL_Z + 0.6), lamp(0x9ec4ff, 6, 9, 0, 1.6, 5.4));
  root.add(doorGlow);

  // Golden motes drifting high in the hall.
  const motes: number[] = [];
  for (let k = 0; k < 90; k++) motes.push((r() - 0.5) * 8, 2 + r() * 4.5, -1 + r() * 7);
  const motePts = glowPoints(motes, 0xffd27a, 0.05, 0.8);
  root.add(motePts);

  let flare = 0;
  const flameMat = flamePts.material as PointsMaterial;
  return {
    root,
    look: { wallTint: 0xffffff, hemiSky: 0x7a5232, hemiGround: 0x0a0c18, hemiIntensity: 0.55, fog: new FogExp2(0x05070f, 0.035) },
    envLights: [[-2.25, 2.1, -1, 0xffa64a, 6], [2.25, 2.1, -1, 0xffa64a, 6], [0, 1.6, 6, 0x9ec4ff, 8], [0, 8, 0, 0x2a3450, 2]],
    react: () => (flare = 1),
    update(dt, t) {
      flare = Math.max(0, flare - dt * 0.8);
      const fp = flamePts.geometry.attributes.position;
      diyaHome.forEach((h, i) => {
        const y = h.y + Math.sin(t * 0.8 + i * 1.7) * 0.06;
        diyas.setMatrixAt(i, tmpM.compose(tmpP.set(h.x, y, h.z), tmpQ.identity(), tmpS.set(1, 1, 1)));
        fp.setXYZ(diyaFlameStart + i, h.x, y + 0.05, h.z);
        flameHalo.geometry.attributes.position.setXYZ(diyaFlameStart + i, h.x, y + 0.05, h.z);
      });
      diyas.instanceMatrix.needsUpdate = true;
      fp.needsUpdate = true;
      flameHalo.geometry.attributes.position.needsUpdate = true;
      flameMat.size = 0.13 * (1 + 0.08 * Math.sin(t * 9) + flare * 0.9);
      motePts.rotation.y = t * 0.01;
    },
  };
}

// ---------------------------------------------------------------------------
// B. FORGOTTEN FOREST
// ---------------------------------------------------------------------------

function forest(): WorldSet {
  const root = new Group();
  const r = rng(23);
  root.add(dome(0x01040a, 0x0b2a36, 0x020604));
  const ground = new Mesh(new PlaneGeometry(60, 60), baked(new MeshStandardMaterial({ map: noiseTex([24, 40, 26], 0.5, 31), roughness: 1 }), 0.5));
  (ground.material as MeshStandardMaterial).map!.repeat.set(8, 8);
  ground.rotation.x = -Math.PI / 2;
  root.add(ground);

  const bark = baked(new MeshStandardMaterial({ map: noiseTex([58, 42, 30], 0.55, 41), roughness: 1 }), 0.5);
  const leaves = new MeshStandardMaterial({ color: 0x2a5a3a, roughness: 1, flatShading: true, emissive: 0x123a28, emissiveIntensity: 1 });
  const trees: { p: Vector3; h: number; w: number }[] = [
    { p: new Vector3(-3.7, 0, -1.9), h: 13, w: 1.9 },
    { p: new Vector3(3.7, 0, -1.9), h: 14, w: 2.0 },
  ];
  while (trees.length < 30) {
    const a = r() * Math.PI * 2;
    const d = 3.5 + r() * 16;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    if (!clear(x, z)) continue;
    trees.push({ p: new Vector3(x, 0, z), h: 8 + r() * 8, w: 0.8 + r() * 0.9 });
  }
  const trunks = new InstancedMesh(new CylinderGeometry(0.32, 0.6, 1, 9), bark, trees.length);
  const crowns = new InstancedMesh(new IcosahedronGeometry(1, 1), leaves, trees.length * 2);
  trees.forEach((tr, i) => {
    trunks.setMatrixAt(i, tmpM.compose(tmpP.set(tr.p.x, tr.h / 2, tr.p.z), tmpQ.identity(), tmpS.set(tr.w, tr.h, tr.w)));
    for (let k = 0; k < 2; k++) {
      const s = tr.w * (2.6 - k * 0.6);
      crowns.setMatrixAt(i * 2 + k, tmpM.compose(tmpP.set(tr.p.x + (k ? 0.6 : -0.4), tr.h - 0.6 + k * 1.4, tr.p.z), tmpQ.identity(), tmpS.set(s, s * 0.7, s)));
    }
  });
  trunks.instanceMatrix.needsUpdate = true;
  crowns.instanceMatrix.needsUpdate = true;
  root.add(trunks, crowns);

  // Gnarled roots creeping out from the two giant trees.
  for (const sx of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      const start = new Vector3(sx * 3.7, 0.4, -1.9);
      const curve = new CatmullRomCurve3([
        start,
        new Vector3(sx * (3.0 - k * 0.3), 0.25, -1.4 + k * 0.5),
        new Vector3(sx * (2.4 - k * 0.5), 0.05, -0.9 + k * 0.9),
      ]);
      root.add(new Mesh(new TubeGeometry(curve, 12, 0.11 - k * 0.02, 6, false), bark));
    }
  }

  // Glowing mushrooms: warm caps lit from within.
  const shrooms: { p: Vector3; s: number }[] = [];
  while (shrooms.length < 40) {
    const a = r() * Math.PI * 2;
    const d = 1.4 + r() * 7;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    if (!clear(x, z) && d > 1.5) continue;
    if (Math.hypot(x, z) < 1.35) continue;
    shrooms.push({ p: new Vector3(x, 0, z), s: d < 3.5 ? 0.25 + r() * 0.35 : 0.15 + r() * 0.5 });
  }
  const stemMat = new MeshStandardMaterial({ color: 0xe8d8c0, roughness: 0.8, emissive: 0x3a2a20 });
  const capMat = new MeshStandardMaterial({ color: 0xd8705a, roughness: 0.6, emissive: new Color(0xff7a40), emissiveIntensity: 0.7 });
  const stems = new InstancedMesh(new CylinderGeometry(0.12, 0.16, 1, 8), stemMat, shrooms.length);
  const caps = new InstancedMesh(new SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), capMat, shrooms.length);
  shrooms.forEach((m, i) => {
    stems.setMatrixAt(i, tmpM.compose(tmpP.set(m.p.x, m.s * 0.5, m.p.z), tmpQ.identity(), tmpS.set(m.s, m.s, m.s)));
    caps.setMatrixAt(i, tmpM.compose(tmpP.set(m.p.x, m.s * 0.95, m.p.z), tmpQ.identity(), tmpS.set(m.s * 0.55, m.s * 0.35, m.s * 0.55)));
  });
  stems.instanceMatrix.needsUpdate = true;
  caps.instanceMatrix.needsUpdate = true;
  root.add(stems, caps);
  const glowSpots: number[] = [];
  for (const m of shrooms) glowSpots.push(m.p.x, m.s * 0.8, m.p.z);
  root.add(glowPoints(glowSpots, 0xff8a50, 0.35, 0.4));
  // Giant mushrooms right beside the player, with glowing gills underneath.
  const gillMat = new MeshBasicMaterial({ color: 0xffb46a });
  const giantCap = new MeshStandardMaterial({ color: 0xe0846a, roughness: 0.5, emissive: new Color(0xff6a3a), emissiveIntensity: 0.5 });
  for (const [x, z, sc] of [[-1.9, -0.2, 1.1], [2.1, 0.4, 1.3], [-2.6, 1.8, 0.9], [2.4, 2.6, 0.8]] as const) {
    const stem = new Mesh(new CylinderGeometry(0.1, 0.16, 1, 14), stemMat);
    stem.scale.setScalar(sc);
    stem.position.set(x, 0.5 * sc, z);
    const cap = new Mesh(new SphereGeometry(0.55, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), giantCap);
    cap.scale.set(sc, sc * 0.55, sc);
    cap.position.set(x, 0.95 * sc, z);
    const gills = new Mesh(new CylinderGeometry(0.53, 0.18, 0.06, 24), gillMat);
    gills.scale.setScalar(sc);
    gills.position.set(x, 0.93 * sc, z);
    root.add(stem, cap, gills);
  }
  root.add(lamp(0xff8a4a, 3, 4, -1.9, 0.9, -0.2), lamp(0xff8a4a, 3, 4, 2.1, 1.0, 0.4));
  // Moonbeams slanting down through the canopy.
  for (const [x, z] of [[-2.5, 3], [3, 5.5], [-6, -2.5]]) {
    root.add(lightShaft(new Vector3(x + 1.5, 14, z - 1), new Vector3(x, 0, z), 0.3, 1.2, 0x8ad8ff, 0.08));
  }

  // A dark tunnel mouth into the hillside (the underground secret).
  const rock = baked(new MeshStandardMaterial({ map: noiseTex([50, 48, 44], 0.5, 51), roughness: 1 }), 0.45);
  const arch = new Mesh(new TorusGeometry(1.1, 0.35, 8, 16, Math.PI), rock);
  arch.position.set(-4.6, 0, 1.4);
  arch.rotation.y = Math.PI / 2;
  const hole = new Mesh(new SphereGeometry(1.0, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), new MeshBasicMaterial({ color: 0x000000 }));
  hole.position.set(-4.75, 0, 1.4);
  hole.scale.set(0.2, 1, 1);
  root.add(arch, hole);

  // Fireflies: drift on their own, but gather toward the player's hands.
  const count = 230;
  const fly: number[] = [];
  const home: Vector3[] = [];
  for (let k = 0; k < count; k++) {
    const v = new Vector3((r() - 0.5) * 10, 0.4 + r() * 4, -2 + r() * 8);
    home.push(v);
    fly.push(v.x, v.y, v.z);
  }
  const flies = glowPoints(fly, 0x8ff8ff, 0.09);
  root.add(flies);
  const pos = flies.geometry.attributes.position;
  let pulse = 0;

  return {
    root,
    look: { wallTint: 0xb4c4a4, hemiSky: 0x2a6a80, hemiGround: 0x0a140a, hemiIntensity: 0.65, fog: new FogExp2(0x061418, 0.045) },
    envLights: [[0, 14, 0, 0x8ad8ff, 3], [-2, 1, 0, 0xff8a4a, 4], [2, 1, 1, 0xff8a4a, 4]],
    react: () => (pulse = 1),
    update(dt, t, hands) {
      pulse = Math.max(0, pulse - dt * 0.7);
      capMat.emissiveIntensity = 0.6 + 0.15 * Math.sin(t * 1.3) + pulse * 1.4;
      for (let k = 0; k < count; k++) {
        const h = home[k];
        let x = h.x + Math.sin(t * 0.5 + k) * 0.5;
        let y = h.y + Math.sin(t * 0.7 + k * 2.1) * 0.3;
        let z = h.z + Math.cos(t * 0.4 + k * 0.7) * 0.5;
        for (const hand of hands) {
          const d = Math.hypot(hand.x - x, hand.y - y, hand.z - z);
          if (d < 1.6) {
            const pull = (1 - d / 1.6) * 0.7;
            x += (hand.x - x) * pull + Math.sin(t * 3 + k) * 0.08;
            y += (hand.y - y) * pull + Math.cos(t * 3 + k) * 0.08;
            z += (hand.z - z) * pull;
          }
        }
        if (pulse > 0) {
          x += (x) * pulse * 0.15;
          y += pulse * 0.3;
        }
        pos.setXYZ(k, x, y, z);
      }
      pos.needsUpdate = true;
    },
  };
}

// ---------------------------------------------------------------------------
// C. DARK CASTLE
// ---------------------------------------------------------------------------

function runeTexture(color: string): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.translate(128, 128);
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 12;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(0, 0, 112, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(0, 0, 86, 0, Math.PI * 2);
  ctx.stroke();
  for (let k = 0; k < 12; k++) {
    ctx.save();
    ctx.rotate((k / 12) * Math.PI * 2);
    ctx.beginPath();
    ctx.moveTo(0, -92);
    ctx.lineTo(8, -104);
    ctx.lineTo(-6, -108);
    ctx.lineTo(4, -98);
    ctx.stroke();
    ctx.restore();
  }
  ctx.beginPath();
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    ctx.lineTo(Math.cos(a) * 80, Math.sin(a) * 80);
    ctx.lineTo(Math.cos(a + Math.PI / 6) * 40, Math.sin(a + Math.PI / 6) * 40);
  }
  ctx.closePath();
  ctx.stroke();
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

function castle(): WorldSet {
  const root = new Group();
  root.add(dome(0x020208, 0x1c0c34, 0x020206));
  const slabs = noiseTex([54, 50, 60], 0.4, 61, (ctx) => {
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 3;
    for (let k = 0; k <= 4; k++) {
      ctx.beginPath();
      ctx.moveTo(k * 64, 0);
      ctx.lineTo(k * 64, 256);
      ctx.moveTo(0, k * 64);
      ctx.lineTo(256, k * 64);
      ctx.stroke();
    }
  });
  slabs.repeat.set(10, 10);
  const floor = new Mesh(new PlaneGeometry(30, 30), baked(new MeshStandardMaterial({ map: slabs, roughness: 0.7, metalness: 0.1 }), 0.45));
  floor.rotation.x = -Math.PI / 2;
  root.add(floor);

  const stone = baked(new MeshStandardMaterial({ map: noiseTex([70, 66, 80], 0.4, 71), roughness: 0.9 }), 0.5);
  const zs = [-0.8, 1.6, 4.0, 6.4, 8.8];
  const pillars = new InstancedMesh(new CylinderGeometry(0.42, 0.5, 1, 10), stone, zs.length * 2);
  const capitals = new InstancedMesh(new BoxGeometry(1, 1, 1), stone, zs.length * 2);
  const arches = new InstancedMesh(new TorusGeometry(3.6, 0.16, 6, 28, Math.PI), stone, zs.length);
  zs.forEach((z, i) => {
    for (const [j, sx] of [-1, 1].entries()) {
      pillars.setMatrixAt(i * 2 + j, tmpM.compose(tmpP.set(sx * 3.6, 4.5, z), tmpQ.identity(), tmpS.set(1, 9, 1)));
      capitals.setMatrixAt(i * 2 + j, tmpM.compose(tmpP.set(sx * 3.6, 9.1, z), tmpQ.identity(), tmpS.set(1.2, 0.4, 1.2)));
    }
    // Gothic arch across the nave (stretched upward to point).
    arches.setMatrixAt(i, tmpM.compose(tmpP.set(0, 9.2, z), tmpQ.identity(), tmpS.set(1, 1.6, 1)));
  });
  for (const m of [pillars, capitals, arches]) {
    m.instanceMatrix.needsUpdate = true;
    root.add(m);
  }

  // Giant doors behind the player, sealed with a violet seam.
  const wood = baked(new MeshStandardMaterial({ map: noiseTex([46, 30, 22], 0.6, 81), roughness: 0.85 }), 0.6);
  for (const sx of [-1, 1]) {
    const leaf = new Mesh(new BoxGeometry(1.9, 6.5, 0.3), wood);
    leaf.position.set(sx * 0.97, 3.25, 9.6);
    root.add(leaf);
  }
  const studs = new InstancedMesh(new SphereGeometry(0.06, 6, 4), new MeshStandardMaterial({ color: 0x3a3a44, metalness: 0.9, roughness: 0.4 }), 48);
  const studList: { p: Vector3; s: Vector3 }[] = [];
  for (let row = 0; row < 8; row++) for (let col = 0; col < 6; col++) studList.push({ p: new Vector3(-1.6 + col * 0.64, 0.6 + row * 0.78, 9.43), s: new Vector3(1, 1, 1) });
  placeAll(studs, studList);
  const seam = new Mesh(new PlaneGeometry(0.06, 6.3), new MeshBasicMaterial({ color: 0xb070ff }));
  seam.position.set(0, 3.2, 9.44);
  seam.rotation.y = Math.PI;
  root.add(studs, seam);

  // Hanging violet banners with a golden sigil.
  const bannerTex = (() => {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 192;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#2a1040';
    ctx.fillRect(0, 0, 64, 192);
    ctx.strokeStyle = '#d8a84a';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(32, 70, 18, 0, Math.PI * 2);
    ctx.moveTo(32, 40);
    ctx.lineTo(32, 100);
    ctx.stroke();
    const t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    return t;
  })();
  const bannerMat = baked(new MeshStandardMaterial({ map: bannerTex, side: DoubleSide, roughness: 1 }), 0.8);
  for (const sx of [-1, 1]) {
    for (const z of [0.4, 2.8, 5.2]) {
      const b = new Mesh(new PlaneGeometry(0.9, 2.8), bannerMat);
      b.position.set(sx * 3.05, 5.6, z);
      b.rotation.y = sx * Math.PI / 2;
      root.add(b);
    }
  }

  // Violet torches on the pillars.
  const torchFlames: number[] = [];
  zs.forEach((z) => {
    for (const sx of [-1, 1]) torchFlames.push(sx * 3.1, 2.6, z);
  });
  const torches = glowPoints(torchFlames, 0xb07aff, 0.45, 0.9);
  root.add(lamp(0xa070ff, 5, 7, -3.0, 2.6, 1.6), lamp(0xa070ff, 5, 7, 3.0, 2.6, 1.6), lamp(0xc89aff, 4, 9, 0, 4, 9));
  for (const [x, z] of [[-3.4, 3], [3.4, 6]]) root.add(lightShaft(new Vector3(x, 9, z), new Vector3(x * 0.2, 0, z - 1.5), 0.3, 1.0, 0xb48cff, 0.1));
  root.add(torches);
  const sconces = new InstancedMesh(new ConeGeometry(0.1, 0.25, 6), new MeshStandardMaterial({ color: 0x222228, metalness: 0.8, roughness: 0.5 }), torchFlames.length / 3);
  placeAll(sconces, zs.flatMap((z) => [-1, 1].map((sx) => ({ p: new Vector3(sx * 3.12, 2.45, z), s: new Vector3(1, 1, 1), rz: Math.PI }))));
  root.add(sconces);

  // Trap glyphs glowing on the floor.
  const runeMat = new MeshBasicMaterial({ map: runeTexture('#b57bff'), transparent: true, blending: AdditiveBlending, depthWrite: false });
  const runes: Mesh[] = [];
  for (const [x, z] of [[-2.0, 0.6], [2.0, 0.6], [0, 3.6]]) {
    const g = new Mesh(new PlaneGeometry(1.6, 1.6), runeMat);
    g.rotation.x = -Math.PI / 2;
    g.position.set(x, 0.01, z);
    runes.push(g);
    root.add(g);
  }
  const mist: number[] = [];
  const r = rng(91);
  for (let k = 0; k < 70; k++) mist.push((r() - 0.5) * 7, r() * 1.2, -1 + r() * 10);
  const mistPts = glowPoints(mist, 0x6a3aa8, 0.9, 0.25);
  root.add(mistPts);

  let flare = 0;
  return {
    root,
    look: { wallTint: 0xb8b0c8, hemiSky: 0x5a3a8a, hemiGround: 0x08060e, hemiIntensity: 0.6, fog: new FogExp2(0x0c0618, 0.05) },
    envLights: [[-3, 2.6, 2, 0xa070ff, 6], [3, 2.6, 2, 0xa070ff, 6], [0, 4, 9, 0xc89aff, 5]],
    react: () => (flare = 1),
    update(dt, t) {
      flare = Math.max(0, flare - dt * 0.8);
      runes.forEach((g, i) => (g.rotation.z = t * (0.15 + i * 0.05) * (i % 2 ? -1 : 1)));
      runeMat.opacity = 0.55 + 0.2 * Math.sin(t * 1.7) + flare * 0.45;
      (torches.material as PointsMaterial).size = 0.45 * (1 + 0.1 * Math.sin(t * 11) + flare * 0.8);
      mistPts.rotation.y = Math.sin(t * 0.05) * 0.2;
    },
  };
}

// ---------------------------------------------------------------------------
// D. SKY KINGDOM
// ---------------------------------------------------------------------------

function sky(): WorldSet {
  const root = new Group();
  const r = rng(101);
  root.add(dome(0x2a4aa8, 0xffc6a0, 0x8a9ad8));
  // A pale moon hanging over the islands.
  const moon = new Mesh(new SphereGeometry(5, 24, 16), new MeshBasicMaterial({ color: 0xece6ff, fog: false }));
  moon.position.set(-22, 22, -38);
  const moonRing = new Mesh(new TorusGeometry(8, 0.25, 6, 64), new MeshBasicMaterial({ color: 0xf0e0ff, transparent: true, opacity: 0.5, fog: false }));
  moonRing.position.copy(moon.position);
  moonRing.rotation.set(1.2, 0.3, 0.4);
  root.add(moon, moonRing, glowPoints([-22, 22, -38], 0xd8ccff, 30, 0.35));

  // The player's own island.
  const grass = baked(new MeshStandardMaterial({ color: 0x5a9a44, roughness: 1, flatShading: true }), 0.45);
  const rock = baked(new MeshStandardMaterial({ map: noiseTex([110, 96, 86], 0.45, 111), roughness: 1, flatShading: true }), 0.55);
  const home = new Mesh(new CylinderGeometry(2.8, 2.6, 0.35, 18), grass);
  home.position.set(0, -0.18, 0.4);
  const homeRock = new Mesh(new ConeGeometry(2.6, 3.8, 14), rock);
  homeRock.rotation.x = Math.PI;
  homeRock.position.set(0, -2.25, 0.4);
  // Under the shadow wall: a floating stone slab holding it up.
  const slab = new Mesh(new BoxGeometry(7.4, 0.6, 0.8), rock);
  slab.position.set(0, -0.55, WALL_Z - 0.1);
  const slabRock = new Mesh(new ConeGeometry(3.4, 4, 10), rock);
  slabRock.rotation.x = Math.PI;
  slabRock.scale.z = 0.25;
  slabRock.position.set(0, -2.85, WALL_Z - 0.1);
  root.add(home, homeRock, slab, slabRock);
  const flowers = new InstancedMesh(new IcosahedronGeometry(0.05, 0), new MeshStandardMaterial({ color: 0xffffff, emissive: 0x332244, roughness: 0.6 }), 36);
  const petals = [0xff8ab8, 0xffd36a, 0xb8a0ff, 0xffffff];
  for (let k = 0; k < 36; k++) {
    const a = r() * Math.PI * 2;
    const d = 1.5 + r() * 1.1;
    flowers.setMatrixAt(k, tmpM.compose(tmpP.set(Math.cos(a) * d, 0.02, Math.sin(a) * d + 0.4), tmpQ.identity(), tmpS.set(1, 1, 1)));
    flowers.setColorAt(k, new Color(petals[k % 4]));
  }
  flowers.instanceMatrix.needsUpdate = true;
  root.add(flowers);

  // Floating islands all around.
  const isl: { p: Vector3; s: number; ph: number }[] = [];
  while (isl.length < 11) {
    const a = r() * Math.PI * 2;
    const d = 7 + r() * 16;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    if (!clear(x, z)) continue;
    isl.push({ p: new Vector3(x, -2 + r() * 8, z), s: 0.7 + r() * 2.2, ph: r() * 6 });
  }
  const tops = new InstancedMesh(new CylinderGeometry(1, 0.9, 0.3, 10), grass, isl.length);
  const rocks = new InstancedMesh(new ConeGeometry(0.95, 2.6, 9), rock, isl.length);
  const islandTrees = new InstancedMesh(new ConeGeometry(0.3, 0.9, 7), baked(new MeshStandardMaterial({ color: 0x3a7a44, flatShading: true }), 0.5), isl.length * 2);
  root.add(tops, rocks, islandTrees);
  // Magic crystals and blossom trees scattered on the islands.
  const crystals = new InstancedMesh(new OctahedronGeometry(0.25, 0), new MeshStandardMaterial({ color: 0x9ae8ff, emissive: 0x3ab0e0, emissiveIntensity: 1.2, roughness: 0.2, metalness: 0.1 }), 18);
  const blossoms = new InstancedMesh(new IcosahedronGeometry(0.45, 1), new MeshStandardMaterial({ color: 0xe8a0d8, emissive: 0x6a3060, emissiveIntensity: 0.8, roughness: 0.9, flatShading: true }), 10);
  root.add(crystals, blossoms);

  // A sky palace on the largest island, behind and to the right of the wall.
  const palace = new Group();
  const ivory = baked(new MeshStandardMaterial({ color: 0xf2ead8, roughness: 0.6 }), 0.7);
  const roof = new MeshStandardMaterial({ color: 0x3ab0c8, roughness: 0.4, metalness: 0.3, emissive: 0x0a3040 });
  const base = new Mesh(new CylinderGeometry(4.5, 3.8, 0.8, 14), grass);
  const under = new Mesh(new ConeGeometry(3.8, 7, 12), rock);
  under.rotation.x = Math.PI;
  under.position.y = -3.9;
  palace.add(base, under);
  const towerSpots = [[0, 0, 3.4, 0.9], [-2, 1, 2.2, 0.6], [2.1, -0.8, 2.6, 0.65], [1, 1.8, 1.8, 0.5], [-1.2, -1.9, 1.6, 0.45]];
  for (const [x, z, h, w] of towerSpots) {
    const tw = new Mesh(new CylinderGeometry(w, w * 1.1, h * 2, 10), ivory);
    tw.position.set(x, h + 0.4, z);
    const cap = new Mesh(new ConeGeometry(w * 1.3, h * 1.2, 10), roof);
    cap.position.set(x, h * 2 + 0.4 + h * 0.6, z);
    palace.add(tw, cap);
  }
  // Glowing windows in the palace towers.
  const windows: number[] = [];
  for (const [x, z, h, w] of towerSpots) for (let k = 0; k < 3; k++) windows.push(x + w * 0.9, 0.8 + (h * 2 * (k + 1)) / 4, z + w * 0.4);
  palace.add(glowPoints(windows, 0x8af0ff, 0.5, 0.9));
  palace.position.set(9, 3.5, -16);
  palace.scale.setScalar(1.3);
  root.add(palace);

  // Waterfalls pouring off islands (scrolling streaks) with mist below.
  const fallTex = (() => {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 256;
    const ctx = c.getContext('2d')!;
    for (let k = 0; k < 40; k++) {
      ctx.fillStyle = `rgba(255,255,255,${0.15 + Math.random() * 0.5})`;
      ctx.fillRect(Math.random() * 64, Math.random() * 256, 2 + Math.random() * 4, 30 + Math.random() * 80);
    }
    const t = new CanvasTexture(c);
    t.wrapS = t.wrapT = RepeatWrapping;
    return t;
  })();
  const fallMat = new MeshBasicMaterial({ map: fallTex, color: 0xcfefff, transparent: true, opacity: 0.85, side: DoubleSide, depthWrite: false });
  const falls: Mesh[] = [];
  const mist: number[] = [];
  for (const [x, y, z, h] of [[9.5, 3.3, -13.2, 12], [-11, 2, -6, 8], [6, 1, 9, 7]]) {
    const f = new Mesh(new PlaneGeometry(1.2, h), fallMat);
    f.position.set(x, y - h / 2, z);
    f.lookAt(0, y - h / 2, 0);
    falls.push(f);
    root.add(f);
    mist.push(x, y - h, z);
  }
  root.add(glowPoints(mist, 0xffffff, 4, 0.4));

  // A glowing bridge of planks from the home island to a neighbour.
  const planks = new InstancedMesh(new BoxGeometry(0.9, 0.06, 0.28), baked(new MeshStandardMaterial({ color: 0x8a5a3a, roughness: 0.9 }), 0.5), 26);
  const lanterns: number[] = [];
  const a = new Vector3(-2.4, 0, 1.2);
  const b = new Vector3(-8.5, 0.8, 4.5);
  for (let k = 0; k < 26; k++) {
    const u = k / 25;
    const p = a.clone().lerp(b, u);
    p.y += Math.sin(u * Math.PI) * -0.5;
    const yaw = Math.atan2(b.x - a.x, b.z - a.z);
    planks.setMatrixAt(k, tmpM.compose(p, tmpQ.setFromAxisAngle(UP, yaw + Math.PI / 2), tmpS.set(1, 1, 1)));
    if (k % 5 === 0) lanterns.push(p.x, p.y + 0.6, p.z);
  }
  planks.instanceMatrix.needsUpdate = true;
  root.add(planks, glowPoints(lanterns, 0xffc860, 0.35));
  const endIsland = new Mesh(new CylinderGeometry(1.6, 1.4, 0.3, 10), grass);
  endIsland.position.set(-9.2, 0.65, 5);
  const endRock = new Mesh(new ConeGeometry(1.4, 3, 9), rock);
  endRock.rotation.x = Math.PI;
  endRock.position.set(-9.2, -0.95, 5);
  root.add(endIsland, endRock);

  // Clouds: big soft puffs below and around.
  const clouds: number[] = [];
  for (let k = 0; k < 90; k++) {
    const ang = r() * Math.PI * 2;
    const d = 6 + r() * 28;
    clouds.push(Math.cos(ang) * d, -7 + r() * 7, Math.sin(ang) * d);
  }
  const cloudPts = glowPoints(clouds, 0xfff4ee, 7, 0.55, false);
  root.add(cloudPts);

  let sparkle = 0;
  return {
    root,
    look: { wallTint: 0xeee4d2, hemiSky: 0xffe2c8, hemiGround: 0x5a6aa0, hemiIntensity: 1.0, fog: new FogExp2(0xd8b8c8, 0.012) },
    envLights: [[0, 20, -10, 0xffe2c8, 6], [-20, 5, -30, 0xffb080, 6], [20, 5, 20, 0x8aa0ff, 3]],
    react: () => (sparkle = 1),
    update(dt, t) {
      sparkle = Math.max(0, sparkle - dt * 0.6);
      isl.forEach((it, i) => {
        const y = it.p.y + Math.sin(t * 0.3 + it.ph) * 0.25;
        tops.setMatrixAt(i, tmpM.compose(tmpP.set(it.p.x, y, it.p.z), tmpQ.identity(), tmpS.set(it.s, it.s, it.s)));
        rocks.setMatrixAt(i, tmpM.compose(tmpP.set(it.p.x, y - 1.4 * it.s, it.p.z), tmpQ.setFromAxisAngle(new Vector3(1, 0, 0), Math.PI), tmpS.set(it.s, it.s, it.s)));
        for (let k = 0; k < 2; k++) {
          islandTrees.setMatrixAt(i * 2 + k, tmpM.compose(tmpP.set(it.p.x + (k ? 0.4 : -0.3) * it.s, y + 0.55 * it.s, it.p.z + (k ? -0.2 : 0.3) * it.s), tmpQ.identity(), tmpS.set(it.s, it.s, it.s)));
        }
      });
      isl.forEach((it, i) => {
        const y = it.p.y + Math.sin(t * 0.3 + it.ph) * 0.25;
        if (i < 9) {
          for (let k = 0; k < 2; k++) {
            crystals.setMatrixAt(i * 2 + k, tmpM.compose(tmpP.set(it.p.x + (k ? -0.5 : 0.2) * it.s, y + 0.35 * it.s, it.p.z + (k ? 0.4 : -0.5) * it.s), tmpQ.setFromAxisAngle(UP, t * 0.5 + i), tmpS.set(it.s * 0.8, it.s * (1.3 + k * 0.5), it.s * 0.8)));
          }
        }
        if (i < 10) blossoms.setMatrixAt(i, tmpM.compose(tmpP.set(it.p.x - 0.1 * it.s, y + 1.05 * it.s, it.p.z + 0.25 * it.s), tmpQ.identity(), tmpS.set(it.s, it.s * 0.8, it.s)));
      });
      crystals.instanceMatrix.needsUpdate = true;
      blossoms.instanceMatrix.needsUpdate = true;
      tops.instanceMatrix.needsUpdate = true;
      rocks.instanceMatrix.needsUpdate = true;
      islandTrees.instanceMatrix.needsUpdate = true;
      fallTex.offset.y = (fallTex.offset.y + dt * 0.9) % 1;
      fallMat.opacity = 0.75 + sparkle * 0.25;
      cloudPts.rotation.y = t * 0.004;
      palace.position.y = 3.5 + Math.sin(t * 0.2) * 0.3;
    },
  };
}

// ---------------------------------------------------------------------------
// E. SHADOW REALM
// ---------------------------------------------------------------------------

function realm(): WorldSet {
  const root = new Group();
  const r = rng(131);
  root.add(dome(0x03050c, 0x16284a, 0x020306));
  // A huge icy moon rising behind the wall.
  const moonTex = noiseTex([150, 190, 220], 0.35, 141, (ctx) => {
    for (let k = 0; k < 40; k++) {
      ctx.strokeStyle = 'rgba(40,70,110,0.35)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(Math.random() * 256, Math.random() * 256, 4 + Math.random() * 22, 0, Math.PI * 2);
      ctx.stroke();
    }
  });
  const moon = new Mesh(new SphereGeometry(14, 32, 20), new MeshBasicMaterial({ map: moonTex, color: 0x9fd0ff, fog: false }));
  moon.position.set(4, 12, -42);
  root.add(moon, glowPoints([4, 12, -41], 0x6ab8ff, 60, 0.3));

  // Cracked obsidian floor with violet light in the cracks.
  const crack = noiseTex([30, 32, 44], 0.35, 151, (ctx) => {
    ctx.strokeStyle = 'rgba(170,110,255,0.9)';
    ctx.lineWidth = 2;
    for (let k = 0; k < 14; k++) {
      ctx.beginPath();
      let x = Math.random() * 256;
      let y = Math.random() * 256;
      ctx.moveTo(x, y);
      for (let s = 0; s < 6; s++) {
        x += (Math.random() - 0.5) * 60;
        y += (Math.random() - 0.5) * 60;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  });
  // Big stone slabs between the glowing cracks.
  const crackCtx = (crack.image as HTMLCanvasElement).getContext?.('2d');
  if (crackCtx) {
    crackCtx.strokeStyle = 'rgba(0,0,0,0.75)';
    crackCtx.lineWidth = 4;
    for (let k = 0; k <= 2; k++) {
      crackCtx.beginPath();
      crackCtx.moveTo(k * 128, 0);
      crackCtx.lineTo(k * 128 + (k % 2 ? 10 : -6), 256);
      crackCtx.moveTo(0, k * 128);
      crackCtx.lineTo(256, k * 128 + (k % 2 ? -8 : 6));
      crackCtx.stroke();
    }
    crack.needsUpdate = true;
  }
  crack.repeat.set(6, 6);
  const floor = new Mesh(new CylinderGeometry(20, 20, 0.2, 40), new MeshStandardMaterial({ map: crack, emissiveMap: crack, emissive: 0x5a2aa8, emissiveIntensity: 0.6, roughness: 0.5, metalness: 0.3 }));
  floor.position.y = -0.1;
  root.add(floor);

  // Ruined colossal pillars.
  const stone = baked(new MeshStandardMaterial({ map: noiseTex([70, 76, 90], 0.45, 161), roughness: 0.95 }), 0.55);
  const ruins: { p: Vector3; s: Vector3; rz?: number }[] = [];
  const spots = [[-5, -3], [5.5, -3.5], [-6.5, 2.5], [6.8, 3], [-3.5, 7], [4, 7.5], [-9, -8], [10, -9]];
  spots.forEach(([x, z], i) => {
    const h = i % 3 === 0 ? 6 + r() * 3 : 13 + r() * 5;
    ruins.push({ p: new Vector3(x, h / 2, z), s: new Vector3(1.4, h, 1.4), rz: (r() - 0.5) * 0.08 });
  });
  const pillars = new InstancedMesh(new CylinderGeometry(0.6, 0.7, 1, 10), stone, ruins.length);
  placeAll(pillars, ruins);
  root.add(pillars);

  // Floating rocks orbiting the arena.
  const rockCount = 34;
  const rocks = new InstancedMesh(new DodecahedronGeometry(1, 0), stone, rockCount);
  const orbit: { d: number; y: number; a: number; s: number; sp: number }[] = [];
  for (let k = 0; k < rockCount; k++) orbit.push({ d: 4.5 + r() * 12, y: 1 + r() * 9, a: r() * Math.PI * 2, s: 0.2 + r() * 1.1, sp: 0.02 + r() * 0.05 });
  root.add(rocks);

  // Violet energy rings spinning high above.
  const ringMat = new MeshBasicMaterial({ color: 0x9a5cff, transparent: true, opacity: 0.5, blending: AdditiveBlending, depthWrite: false });
  const rings = [new Mesh(new TorusGeometry(9, 0.06, 6, 64), ringMat), new Mesh(new TorusGeometry(12, 0.05, 6, 64), ringMat)];
  rings.forEach((g, i) => {
    g.position.set(0, 8 + i * 2, -2);
    g.rotation.x = Math.PI / 2 + 0.2 * (i ? 1 : -1);
    root.add(g);
  });

  // The Shadow Eater itself, looming over the wall with burning eyes.
  const giant = new Group();
  const black = new MeshBasicMaterial({ color: 0x030206 });
  const body = new Mesh(new ConeGeometry(4.5, 10, 12), black);
  body.position.y = 5;
  const head = new Mesh(new SphereGeometry(2.1, 16, 12), black);
  head.position.y = 10.6;
  const hornL = new Mesh(new ConeGeometry(0.5, 3, 8), black);
  hornL.position.set(-1.5, 12.6, 0);
  hornL.rotation.z = 0.5;
  const hornR = hornL.clone();
  hornR.position.x = 1.5;
  hornR.rotation.z = -0.5;
  giant.add(body, head, hornL, hornR);
  const eyes = glowPoints([-0.75, 10.9, 1.9, 0.75, 10.9, 1.9], 0xb070ff, 1.4);
  giant.add(eyes);
  giant.position.set(0, -2, -9);
  root.add(giant);

  // Moonlight falling on the arena, and lightning in the distance.
  root.add(lightShaft(new Vector3(3, 16, -20), new Vector3(0, 0, -1), 1.0, 3.0, 0x7ab8ff, 0.06));
  root.add(lamp(0x7ab8ff, 6, 14, 2, 8, -6), lamp(0x9a5cff, 4, 8, 0, 1, 2));
  const boltPts: Vector3[] = [];
  let bx = -14;
  let by = 22;
  while (by > 4) {
    boltPts.push(new Vector3(bx, by, -26));
    bx += (r() - 0.5) * 3;
    by -= 1.5 + r() * 1.5;
  }
  const bolt = new Mesh(new TubeGeometry(new CatmullRomCurve3(boltPts), 40, 0.12, 4, false), new MeshBasicMaterial({ color: 0xdfe8ff, fog: false }));
  const boltGlow = glowPoints([-14, 14, -25], 0xa8c8ff, 24, 0.6);
  bolt.visible = boltGlow.visible = false;
  root.add(bolt, boltGlow);
  let nextBolt = 3;

  // Dark energy rising.
  const motes: number[] = [];
  for (let k = 0; k < 140; k++) motes.push((r() - 0.5) * 18, r() * 10, (r() - 0.5) * 18);
  const rising = glowPoints(motes, 0x8a4aff, 0.12, 0.8);
  root.add(rising);
  const mp = rising.geometry.attributes.position;

  let rage = 0;
  return {
    root,
    look: { wallTint: 0xa8a2c2, hemiSky: 0x4a6aa0, hemiGround: 0x0a0614, hemiIntensity: 0.7, fog: new FogExp2(0x050814, 0.03) },
    envLights: [[4, 12, -40, 0x7ab8ff, 8], [0, 9, -2, 0x9a5cff, 3]],
    react: () => (rage = 1),
    update(dt, t) {
      rage = Math.max(0, rage - dt * 0.5);
      orbit.forEach((o, i) => {
        o.a += o.sp * dt;
        tmpQ.setFromAxisAngle(UP, t * 0.2 + i);
        rocks.setMatrixAt(i, tmpM.compose(tmpP.set(Math.cos(o.a) * o.d, o.y + Math.sin(t * 0.5 + i) * 0.3, Math.sin(o.a) * o.d), tmpQ, tmpS.set(o.s, o.s, o.s)));
      });
      rocks.instanceMatrix.needsUpdate = true;
      rings[0].rotation.z = t * 0.05;
      rings[1].rotation.z = -t * 0.03;
      ringMat.opacity = 0.35 + 0.15 * Math.sin(t * 0.8) + rage * 0.4;
      (eyes.material as PointsMaterial).size = 1.4 * (1 + 0.15 * Math.sin(t * 2) + rage * 1.2);
      giant.position.y = -2 + Math.sin(t * 0.4) * 0.3;
      // Lightning: a double flash every few seconds.
      nextBolt -= dt;
      const flashOn = nextBolt < 0 && (nextBolt > -0.08 || (nextBolt < -0.16 && nextBolt > -0.24));
      bolt.visible = boltGlow.visible = flashOn;
      if (nextBolt < -0.3) {
        nextBolt = 3 + Math.random() * 4;
        bolt.position.x = (Math.random() - 0.5) * 24;
        boltGlow.position.x = bolt.position.x;
      }
      for (let k = 0; k < mp.count; k++) {
        let y = mp.getY(k) + dt * 0.4;
        if (y > 10) y = 0;
        mp.setY(k, y);
      }
      mp.needsUpdate = true;
    },
  };
}

// ---------------------------------------------------------------------------

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
