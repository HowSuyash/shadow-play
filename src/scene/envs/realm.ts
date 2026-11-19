import {
  AdditiveBlending,
  CatmullRomCurve3,
  ConeGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  FogExp2,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  type PointsMaterial,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector3,
} from '@iwsdk/core';
import { WALL_Z } from '../layout.js';
import {
  archBand,
  azX,
  type Bake,
  Batch,
  bakedMat,
  canvas,
  elY,
  fluted,
  glowCards,
  glowPoints,
  islandRock,
  lathe,
  lightShaft,
  noiseField,
  rng,
  rock,
  skyBlob,
  skyDome,
  skyGradient,
  skyStars,
  stoneTex,
  tiled,
  toTex,
  UP,
  wallSurface,
  type WorldSet,
} from './kit.js';

/**
 * E. THE SHADOW REALM — the Shadow Eater's domain: a vast ruined colonnade of
 * fluted columns on cracked flagstones under a colossal cratered planet, with
 * shattered rock adrift in the air, violet corruption seeping from the cracks,
 * lightning on the horizon, and the Shadow Eater itself looming beyond the wall.
 */

const PLANET = new Vector3(10, 26, -95);

/** Cratered planet surface (equirect). */
function planetTex(): ReturnType<typeof toTex> {
  const W = 1024;
  const H = 512;
  const [c, ctx] = canvas(W, H);
  const n = noiseField(256, 701, 6, 4);
  const img = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const v = n[((y >> 1) & 255) * 256 + ((x >> 2) & 255)];
      const mare = v < 0.45 ? 0.72 : 1;
      const k = (0.65 + v * 0.55) * mare;
      const p = (y * W + x) * 4;
      img.data[p] = 120 * k;
      img.data[p + 1] = 168 * k;
      img.data[p + 2] = 205 * k;
      img.data[p + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const r = rng(702);
  for (let k = 0; k < 160; k++) {
    const x = r() * W;
    const y = H * 0.1 + r() * H * 0.8;
    const R = 3 + Math.pow(r(), 3) * 40;
    ctx.fillStyle = 'rgba(20,40,70,0.35)';
    ctx.beginPath();
    ctx.ellipse(x + R * 0.12, y + R * 0.12, R, R * 0.9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(210,235,255,0.25)';
    ctx.beginPath();
    ctx.ellipse(x - R * 0.1, y - R * 0.1, R * 0.92, R * 0.82, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(230,245,255,0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(x, y, R, R * 0.9, 0, Math.PI, Math.PI * 1.9);
    ctx.stroke();
  }
  return toTex(c, false);
}

/** A classical column: moulded base, fluted shaft, capital — or a broken stump. */
function addColumn(b: Batch, x: number, z: number, h: number, broken: number, seed: number, s = 1): void {
  b.add(COL_BASE, x, 0, z, 0, 0, 0, s, s, s, 0xc8d0e0);
  const shaft = broken ? h * broken : h;
  b.add(FLUTED, x, 0.55 * s, z, 0, seed, 0, s, shaft - 0.55 * s, s, 0xb8c0d4, [1, shaft / 3]);
  if (broken) {
    b.add(rock(seed, 1, 0.45, 0.5), x, shaft, z, 0, seed, 0, 0.62 * s, 0.35 * s, 0.62 * s, 0xa8b0c4);
  } else {
    b.add(COL_CAP, x, h, z, 0, 0, 0, s, s, s, 0xd0d8e8);
    b.box(x, h + 0.62 * s, z, 1.7 * s, 0.24 * s, 1.7 * s, 0xc8d0e0, 1.4);
  }
}
const COL_BASE = lathe([0, 0, 0.95, 0, 0.95, 0.2, 0.82, 0.24, 0.86, 0.36, 0.72, 0.42, 0.7, 0.55, 0, 0.55], 24);
const FLUTED = fluted(0.66, 0.58, 18, 0.07, 6);
const COL_CAP = lathe([0, 0, 0.62, 0, 0.66, 0.08, 0.86, 0.32, 0.86, 0.5, 0, 0.5], 24);

export function realm(): WorldSet {
  const root = new Group();
  const r = rng(131);

  root.add(
    skyDome((ctx, w, h) => {
      skyGradient(ctx, w, h, [[90, '#02040c'], [50, '#061232'], [20, '#14305a'], [6, '#2a5a86'], [0, '#3a6a90'], [-6, '#0c1a2c'], [-90, '#020306']]);
      skyBlob(ctx, w, h, 6, 15, 70, 30, 'rgba(110,190,255,A)', 0.35);
      skyBlob(ctx, w, h, -60, 30, 60, 25, 'rgba(120,60,200,A)', 0.25);
      skyBlob(ctx, w, h, 120, 22, 80, 22, 'rgba(70,40,160,A)', 0.22);
      skyStars(ctx, w, h, 2400, 133, 6);
      // A second, smaller moon behind the player.
      const mx = azX(160, w);
      const my = elY(30, h);
      const g = ctx.createRadialGradient(mx, my, 0, mx, my, 40);
      g.addColorStop(0, 'rgba(220,235,255,1)');
      g.addColorStop(0.4, 'rgba(200,225,255,1)');
      g.addColorStop(0.5, 'rgba(140,190,255,0.3)');
      g.addColorStop(1, 'rgba(120,170,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(mx - 40, my - 40, 80, 80);
      // Distant ruined skyline silhouette along the horizon.
      ctx.fillStyle = '#060c18';
      const rr = rng(134);
      ctx.beginPath();
      ctx.moveTo(0, elY(0, h));
      for (let x = 0; x <= w; x += 6) {
        const tower = rr() < 0.05 ? 4 + rr() * 9 : 0;
        ctx.lineTo(x, elY(0.6 + Math.sin(x * 0.01) * 0.8 + rr() * 0.6 + tower, h));
      }
      ctx.lineTo(w, h);
      ctx.lineTo(0, h);
      ctx.fill();
    }),
  );

  // The colossal planet behind the wall, with an atmospheric halo.
  const planet = new Mesh(new SphereGeometry(34, 48, 32), new MeshBasicMaterial({ map: planetTex(), fog: false }));
  planet.position.copy(PLANET);
  planet.rotation.set(0.3, 2.2, 0.2);
  root.add(planet, glowCards([[PLANET.x, PLANET.y, PLANET.z + 6, 100]], 0x5ab0ff, 0.45));

  const moonDir = new Vector3().copy(PLANET).normalize();
  const env: Bake = {
    sky: 0x6a8ac8,
    ground: 0x0e1020,
    amb: 0.58,
    ao: 0.45,
    aoHeight: 1.2,
    sun: { dir: moonDir, color: 0x8ac8ff, k: 0.6 },
    lights: [
      { p: new Vector3(0, 0.5, -3), color: 0x9a5cff, k: 1.2, r: 8 },
      { p: new Vector3(0, 6, -14), color: 0x8a50ff, k: 1.6, r: 14 },
      { p: new Vector3(0, 1.6, 0), color: 0xffb070, k: 0.45, r: 4 },
    ],
  };

  // --- Flagstones --------------------------------------------------------------------
  const floorT = stoneTex({ seed: 703, base: [104, 112, 132], vary: 0.5, rows: 3, cols: 3, mortar: 4, cracks: 22, tint2: [80, 84, 110], tint2Amt: 0.3 });
  const floor = new Batch(bakedMat(tiled(floorT, 1, 1)));
  const fGeo = new PlaneGeometry(90, 90, 60, 60);
  fGeo.rotateX(-Math.PI / 2);
  const fp = fGeo.attributes.position;
  for (let i = 0; i < fp.count; i++) {
    const x = fp.getX(i);
    const z = fp.getZ(i);
    const d = Math.hypot(x, z + 6);
    // The plaza falls away into broken ground at its edge.
    if (d > 26) fp.setY(i, -(d - 26) * 0.5);
  }
  fGeo.computeVertexNormals();
  floor.add(fGeo, 0, 0, -6, 0, 0, 0, 1, 1, 1, 0xffffff, [26, 26]);

  // --- The colonnade -----------------------------------------------------------------
  const stoneT = stoneTex({ seed: 704, base: [150, 158, 178], vary: 0.45, cracks: 12, tint2: [100, 110, 140], tint2Amt: 0.35 });
  const stone = new Batch(bakedMat(stoneT));
  let i = 0;
  for (let z = 6; z >= -30; z -= 4.2) {
    for (const sx of [-1, 1]) {
      const x = sx * (z < WALL_Z ? 7.6 : 5.8);
      const roll = r();
      if (roll < 0.12) {
        // Missing: just the base and a toppled drum nearby.
        stone.add(COL_BASE, x, 0, z, 0, 0, 0, 1, 1, 1, 0xc0c8d8);
        stone.add(new CylinderGeometry(0.62, 0.62, 1.8, 18), x + sx * 1.6, 0.6, z + 0.8, 0, r() * 3, Math.PI / 2, 1, 1, 1, 0xb0b8cc);
        continue;
      }
      const h = 9 + r() * 6;
      addColumn(stone, x, z, h, roll < 0.42 ? 0.3 + r() * 0.5 : 0, i++);
    }
  }
  // An architrave still standing across a few columns, and a great ruined arch at the far end.
  for (const sx of [-1, 1]) stone.box(sx * 7.6, 13.4, -18.3, 1.5, 0.9, 8.6, 0xb8c0d4, 2);
  stone.add(new ExtrudeGeometry(archBand(14, 11.5, 0, 'round'), { depth: 1.6, bevelEnabled: false, curveSegments: 18 }), 0, 12, -34, 0, 0, 0, 1, 1, 1, 0xa8b0c4, [0.3, 0.3]);
  for (const sx of [-1, 1]) stone.box(sx * 6.4, 6, -33.2, 1.6, 12, 1.6, 0xa0a8bc, 2);
  // Broken columns framing the wall, with a cracked lintel above.
  for (const sx of [-1, 1]) addColumn(stone, sx * 4.25, WALL_Z - 0.3, 6.6, sx < 0 ? 0 : 0.86, 90 + sx, 0.85);
  stone.add(rock(97, 2, 0.12, 1), -1.4, 6.6, WALL_Z - 0.3, 0, 0, -0.06, 3.6, 0.45, 0.55, 0xc0c8dc);
  // Rubble and toppled drums around the plaza.
  for (let k = 0; k < 40; k++) {
    const a = r() * Math.PI * 2;
    const d = 3 + r() * 22;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d - 4;
    if (Math.abs(x) < 4.5 && z < 0 && z > -14) continue;
    if (Math.hypot(x, z) < 2) continue;
    const s = 0.15 + r() * 0.6;
    stone.add(rock(k + 200, 1, 0.35, 0.6), x, s * 0.25, z, 0, r() * 6, 0, s * 1.2, s, s, 0xa8b0c4);
  }
  // Ruined wall fragments with arches on the flanks.
  for (const [x, z, ry] of [[-14, -6, 0.3], [14, -10, -0.4], [-12, 8, 2.6], [13, 9, -2.4]] as const) {
    stone.add(new ExtrudeGeometry(archBand(6, 3.6, 3.2, 'round'), { depth: 1, bevelEnabled: false }), x, 0, z, 0, ry, 0, 1, 1, 1, 0x9aa2b8, [0.4, 0.4]);
  }
  // Drifting floating islands of rock in the distance.
  for (const [x, y, z, s] of [[-30, 14, -40, 5], [34, 18, -50, 6], [-40, 10, 10, 4], [28, 20, 30, 4.5], [0, 30, 40, 5]] as const) {
    stone.add(islandRock(x + z, 3), x, y, z, 0, 0, 0, s, s * 0.9, s, 0x8a92a8, [2, 2]);
    stone.add(new CylinderGeometry(1, 1, 0.4, 24), x, y + 0.1, z, 0, 0, 0, s, 1, s, 0x9aa2b8);
  }

  root.add(floor.build(env), stone.build(env));

  // Violet corruption glowing in the floor cracks (an additive decal near the wall).
  const crackT = (() => {
    const [c, ctx] = canvas(512);
    const g = ctx.createRadialGradient(256, 256, 30, 256, 256, 256);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 512, 512);
    ctx.strokeStyle = '#b07aff';
    ctx.shadowColor = '#9a5cff';
    ctx.shadowBlur = 10;
    const rr = rng(705);
    for (let k = 0; k < 18; k++) {
      ctx.lineWidth = 1.5 + rr() * 2.5;
      ctx.beginPath();
      let x = 256 + (rr() - 0.5) * 80;
      let y = 256 + (rr() - 0.5) * 80;
      ctx.moveTo(x, y);
      const a = rr() * Math.PI * 2;
      for (let s = 0; s < 9; s++) {
        x += Math.cos(a + (rr() - 0.5) * 1.4) * 28;
        y += Math.sin(a + (rr() - 0.5) * 1.4) * 28;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    return toTex(c, false);
  })();
  const crackMat = new MeshBasicMaterial({ map: crackT, transparent: true, blending: AdditiveBlending, depthWrite: false });
  for (const [x, z, s] of [[0, -4, 9], [-5, 3, 6], [5, 2, 5], [0, -14, 12]] as const) {
    const d = new Mesh(new PlaneGeometry(s, s), crackMat);
    d.rotation.set(-Math.PI / 2, 0, x + z);
    d.position.set(x, 0.012, z);
    root.add(d);
  }

  // --- Floating rocks orbiting the arena -------------------------------------------
  const rockMat = new MeshLambertMaterial({ map: tiled(stoneT, 1, 1), color: 0xb8c4e0, emissive: 0x1a1430, flatShading: true });
  const rockCount = 30;
  const rocks = new InstancedMesh(rock(3, 1, 0.4, 0.75), rockMat, rockCount);
  const orbit: { d: number; y: number; a: number; s: number; sp: number }[] = [];
  for (let k = 0; k < rockCount; k++) orbit.push({ d: 6 + r() * 14, y: 3 + r() * 12, a: r() * Math.PI * 2, s: 0.25 + r() * 1.3, sp: 0.015 + r() * 0.04 });
  root.add(rocks);

  // Violet energy rings spinning high above.
  const ringMat = new MeshBasicMaterial({ color: 0x9a5cff, transparent: true, opacity: 0.5, blending: AdditiveBlending, depthWrite: false });
  const rings = [new Mesh(new TorusGeometry(10, 0.06, 6, 80), ringMat), new Mesh(new TorusGeometry(13, 0.05, 6, 80), ringMat)];
  rings.forEach((g, k) => {
    g.position.set(0, 12 + k * 2, -6);
    g.rotation.x = Math.PI / 2 + 0.2 * (k ? 1 : -1);
    root.add(g);
  });

  // --- The Shadow Eater, looming beyond the wall ------------------------------------
  const giant = new Group();
  const black = new MeshBasicMaterial({ color: 0x05030a });
  const robe = new Mesh(lathe([0, 0, 5.2, 0, 4.4, 2, 3.4, 5, 2.8, 8, 3.6, 9.4, 1.4, 10.4, 0, 10.6], 20), black);
  const head = new Mesh(new SphereGeometry(1.7, 16, 12), black);
  head.scale.set(1, 1.15, 0.95);
  head.position.y = 11.6;
  const hood = new Mesh(new ConeGeometry(2.4, 3.4, 16, 1, true), black);
  hood.position.y = 12.5;
  giant.add(robe, head, hood);
  for (const sx of [-1, 1]) {
    const horn = new Mesh(new TubeGeometry(new CatmullRomCurve3([new Vector3(sx * 1.1, 12.6, 0), new Vector3(sx * 2.4, 14.2, 0.3), new Vector3(sx * 2.6, 16.2, -0.4)]), 12, 0.3, 6), black);
    const arm = new Mesh(new TubeGeometry(new CatmullRomCurve3([new Vector3(sx * 3.2, 9.2, 0), new Vector3(sx * 6, 7, 1.5), new Vector3(sx * 7, 4, 3), new Vector3(sx * 6.4, 2.4, 4.2)]), 16, 0.65, 8), black);
    giant.add(horn, arm);
    // Claws.
    for (let k = 0; k < 4; k++) {
      const claw = new Mesh(new ConeGeometry(0.16, 1.4, 6), black);
      claw.position.set(sx * (6.0 + k * 0.3), 1.8, 4.6 + (k - 1.5) * 0.25);
      claw.rotation.set(0.6, 0, sx * 0.3);
      giant.add(claw);
    }
  }
  const eyes = glowPoints([-0.6, 11.8, 1.5, 0.6, 11.8, 1.5], 0xc080ff, 1.3);
  const eyeHalo = glowPoints([-0.6, 11.8, 1.5, 0.6, 11.8, 1.5], 0x8a40ff, 4, 0.5);
  giant.add(eyes, eyeHalo);
  // Wisps of shadow trailing up from its shoulders.
  const wisps: number[] = [];
  for (let k = 0; k < 60; k++) wisps.push((r() - 0.5) * 8, 6 + r() * 9, (r() - 0.5) * 3);
  const wispPts = glowPoints(wisps, 0x6a3ab8, 0.8, 0.35);
  giant.add(wispPts);
  giant.position.set(0, -1, -16);
  giant.name = 'shadow-eater-giant';
  root.add(giant);

  // Moonlight falling on the plaza; lightning on the horizon.
  root.add(lightShaft(new Vector3(6, 20, -40), new Vector3(0, 0, -4), 1.2, 3.2, 0x7ab8ff, 0.07));
  const boltPts: Vector3[] = [];
  let bx = 0;
  let by = 26;
  while (by > 2) {
    boltPts.push(new Vector3(bx, by, 0));
    bx += (r() - 0.5) * 3;
    by -= 1.5 + r() * 1.5;
  }
  const bolt = new Mesh(new TubeGeometry(new CatmullRomCurve3(boltPts), 40, 0.14, 4, false), new MeshBasicMaterial({ color: 0xe8f0ff, fog: false }));
  const boltGlow = glowCards([[0, 14, 0, 36]], 0xa8c8ff, 0.6, new Vector3(0, 14, 40));
  const boltRoot = new Group();
  boltRoot.add(bolt, boltGlow);
  boltRoot.visible = false;
  root.add(boltRoot);
  let nextBolt = 3;

  // Dark energy rising.
  const motes: number[] = [];
  for (let k = 0; k < 160; k++) motes.push((r() - 0.5) * 22, r() * 12, (r() - 0.5) * 22 - 4);
  const rising = glowPoints(motes, 0x8a4aff, 0.11, 0.8);
  root.add(rising);
  const mp = rising.geometry.attributes.position;

  const wallMap = wallSurface(706, [206, 210, 226], 0.16, (ctx, w, h) => {
    // Old carved border of runes, faintly violet.
    ctx.strokeStyle = 'rgba(110,70,170,0.45)';
    ctx.lineWidth = 3;
    ctx.strokeRect(24, 24, w - 48, h - 48);
    ctx.font = '28px serif';
    ctx.fillStyle = 'rgba(110,70,170,0.4)';
    const glyphs = 'ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ';
    for (let x = 40; x < w - 40; x += 34) {
      ctx.fillText(glyphs[(x / 34) % glyphs.length | 0], x, 18);
      ctx.fillText(glyphs[((x / 34) * 7) % glyphs.length | 0], x, h - 4);
    }
    // Cracks.
    ctx.strokeStyle = 'rgba(40,40,60,0.35)';
    ctx.lineWidth = 1.5;
    const rr = rng(707);
    for (let k = 0; k < 8; k++) {
      ctx.beginPath();
      let x = rr() * w;
      let y = rr() < 0.5 ? 0 : h;
      ctx.moveTo(x, y);
      for (let s = 0; s < 6; s++) {
        x += (rr() - 0.5) * 70;
        y += (y > h / 2 ? -1 : 1) * rr() * 40;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  });

  let rage = 0;
  const m4 = new Matrix4();
  const q = new Quaternion();
  const pv = new Vector3();
  const sv = new Vector3();
  return {
    root,
    look: { wallTint: 0xdcdcee, wallMap, hemiSky: 0x4a6aa0, hemiGround: 0x0a0614, hemiIntensity: 0.7, fog: new FogExp2(0x0a1424, 0.022) },
    envLights: [[PLANET.x * 0.3, PLANET.y * 0.3, PLANET.z * 0.3, 0x7ab8ff, 8], [0, 9, -2, 0x9a5cff, 3]],
    react: () => (rage = 1),
    update(dt, t) {
      rage = Math.max(0, rage - dt * 0.5);
      for (let k = 0; k < orbit.length; k++) {
        const o = orbit[k];
        o.a += o.sp * dt;
        q.setFromAxisAngle(UP, t * 0.2 + k);
        rocks.setMatrixAt(k, m4.compose(pv.set(Math.cos(o.a) * o.d, o.y + Math.sin(t * 0.5 + k) * 0.3, Math.sin(o.a) * o.d - 4), q, sv.set(o.s, o.s, o.s)));
      }
      rocks.instanceMatrix.needsUpdate = true;
      rings[0].rotation.z = t * 0.05;
      rings[1].rotation.z = -t * 0.03;
      ringMat.opacity = 0.35 + 0.15 * Math.sin(t * 0.8) + rage * 0.4;
      crackMat.opacity = 0.6 + 0.25 * Math.sin(t * 1.3) + rage * 0.4;
      (eyes.material as PointsMaterial).size = 1.3 * (1 + 0.15 * Math.sin(t * 2) + rage * 1.2);
      giant.position.y = -1 + Math.sin(t * 0.4) * 0.3;
      wispPts.rotation.y = t * 0.1;
      planet.rotation.y += dt * 0.004;
      // Lightning: a double flash every few seconds somewhere on the horizon.
      nextBolt -= dt;
      boltRoot.visible = nextBolt < 0 && (nextBolt > -0.08 || (nextBolt < -0.16 && nextBolt > -0.24));
      if (nextBolt < -0.3) {
        nextBolt = 3 + Math.random() * 5;
        const a = (Math.random() - 0.5) * 2.4 + (Math.random() < 0.3 ? Math.PI : 0);
        boltRoot.position.set(Math.sin(a) * 45, 0, -Math.cos(a) * 45);
        boltRoot.rotation.y = -a;
      }
      for (let k = 0; k < mp.count; k++) {
        let y = mp.getY(k) + dt * 0.4;
        if (y > 12) y = 0;
        mp.setY(k, y);
      }
      mp.needsUpdate = true;
    },
  };
}
