import {
  AdditiveBlending,
  CatmullRomCurve3,
  CylinderGeometry,
  DoubleSide,
  FogExp2,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  TubeGeometry,
  Vector3,
} from '@iwsdk/core';
import { WALL_Z } from '../layout.js';
import {
  type Bake,
  Batch,
  bakedMat,
  canvas,
  clearOfPlay,
  glowCards,
  glowPoints,
  lathe,
  lightShaft,
  noise3,
  noiseField,
  rng,
  rock,
  skyBlob,
  skyDome,
  skyGradient,
  skyStars,
  soft,
  stoneTex,
  tiled,
  toTex,
  wallSurface,
  type WorldSet,
} from './kit.js';

/**
 * B. THE FORGOTTEN FOREST — a bioluminescent night wood: colossal trees with
 * flared roots vanishing into a dark canopy, pink mushrooms glowing from their
 * gills, clouds of cyan fireflies that gather around your hands, blue mist and
 * moonbeams. The shadow wall is an ancient moss-grown stone tablet gripped by roots.
 */

/** Bark: deep vertical furrows, mossy at the foot. */
function barkTex(seed: number): ReturnType<typeof toTex> {
  const S = 256;
  const [c, ctx] = canvas(S, S);
  const n = noiseField(S, seed, 4, 4);
  const f = noiseField(S, seed + 9, 3, 32);
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      // Furrows: stretched vertical ridges.
      const ridge = Math.abs(Math.sin((x / S) * Math.PI * 14 + n[(y >> 3) * S + x] * 6));
      let k = 0.35 + 0.65 * Math.pow(ridge, 0.5) * (0.7 + 0.5 * f[i]);
      k *= 0.8 + 0.4 * n[i];
      img.data[i * 4] = 96 * k;
      img.data[i * 4 + 1] = 92 * k;
      img.data[i * 4 + 2] = 90 * k;
      img.data[i * 4 + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return toTex(c);
}

/** Leaf-cluster card: a ragged dark silhouette for the canopy. */
function leafTex(): ReturnType<typeof toTex> {
  const S = 256;
  const [c, ctx] = canvas(S, S);
  const r = rng(77);
  for (let k = 0; k < 420; k++) {
    const a = r() * Math.PI * 2;
    const d = Math.pow(r(), 0.7) * 110;
    const x = 128 + Math.cos(a) * d;
    const y = 128 + Math.sin(a) * d * 0.75;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(r() * Math.PI * 2);
    const g = 20 + r() * 40;
    ctx.fillStyle = `rgb(${g * 0.5},${g + 20},${g + 30})`;
    ctx.beginPath();
    ctx.ellipse(0, 0, 9 + r() * 6, 3 + r() * 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  return toTex(c, false);
}

/** Fern frond card. */
function fernTex(): ReturnType<typeof toTex> {
  const [c, ctx] = canvas(128, 256);
  ctx.strokeStyle = '#1e4a3a';
  ctx.fillStyle = '#2a6a50';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(64, 256);
  ctx.quadraticCurveTo(70, 120, 54, 8);
  ctx.stroke();
  for (let k = 0; k < 22; k++) {
    const t = k / 22;
    const y = 250 - t * 235;
    const x = 64 + Math.sin(t * 1.5) * 6 - t * 10;
    const len = (1 - t) * 50 + 8;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(x + s * len * 0.5, y - 4, len * 0.5, 4, s * -0.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return toTex(c, false);
}

/** A colossal tree trunk: flared root buttresses, bark ridges, a slight lean. */
function trunkGeo(seed: number, h: number, r0: number): CylinderGeometry {
  const g = new CylinderGeometry(r0 * 0.55, r0, h, 18, 14, true);
  g.translate(0, h / 2, 0);
  const p = g.attributes.position;
  const v = new Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const a = Math.atan2(v.z, v.x);
    const t = v.y / h;
    // Buttress roots near the ground.
    const flare = 1 + 1.6 * Math.exp(-v.y * 1.6) * (0.55 + 0.45 * Math.pow(Math.abs(Math.sin(a * 2.5 + seed)), 3));
    const ridges = 1 + 0.06 * Math.sin(a * 9 + v.y * 0.4 + seed) + noise3(Math.cos(a) * 2, v.y * 0.5, Math.sin(a) * 2 + seed) * 0.08;
    const k = flare * ridges;
    v.x *= k;
    v.z *= k;
    v.x += Math.sin(t * 2.2 + seed) * t * h * 0.06;
    v.z += Math.cos(t * 1.7 + seed) * t * h * 0.04;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

export function forest(): WorldSet {
  const root = new Group();
  const r = rng(23);

  root.add(
    skyDome((ctx, w, h) => {
      skyGradient(ctx, w, h, [[90, '#010208'], [45, '#020a1a'], [18, '#06243a'], [4, '#0c4656'], [0, '#0a3a44'], [-10, '#020a0c'], [-90, '#010304']]);
      skyBlob(ctx, w, h, 20, 25, 120, 30, 'rgba(40,180,200,A)', 0.12);
      skyBlob(ctx, w, h, -120, 15, 90, 20, 'rgba(60,120,220,A)', 0.14);
      skyStars(ctx, w, h, 2200, 31, 8);
    }),
  );

  // --- Lighting: mushroom glow, cool moon, the tunnel's blue breath ----------
  const shroomLights: { p: Vector3; s: number }[] = [];
  const env: Bake = {
    sky: 0x3a7a9a,
    ground: 0x0a1a18,
    amb: 0.55,
    ao: 0.5,
    aoHeight: 1.4,
    sun: { dir: new Vector3(-0.3, 0.85, 0.4).normalize(), color: 0x6ac8ff, k: 0.42 },
    lights: [],
  };

  // --- Ground: mossy, gently rolling outside the play space ------------------
  const groundT = stoneTex({ seed: 401, base: [34, 52, 44], vary: 0.6, tint2: [60, 74, 38], tint2Amt: 0.45, cracks: 0 });
  const ground = new Batch(bakedMat(tiled(groundT, 1, 1)));
  const gGeo = new PlaneGeometry(90, 90, 72, 72);
  gGeo.rotateX(-Math.PI / 2);
  const gp = gGeo.attributes.position;
  for (let i = 0; i < gp.count; i++) {
    const x = gp.getX(i);
    const z = gp.getZ(i);
    const d = Math.hypot(x, z);
    const lift = Math.max(0, d - 7) * 0.06 + noise3(x * 0.15, 0, z * 0.15) * Math.min(1, Math.max(0, d - 5) / 6) * 1.2;
    gp.setY(i, lift);
  }
  gGeo.computeVertexNormals();
  ground.add(gGeo, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0xffffff, [24, 24]);

  // --- Trees ---------------------------------------------------------------------
  const barkB = new Batch(bakedMat(barkTex(402)));
  const trees: { x: number; z: number; h: number; r: number }[] = [
    { x: -4.6, z: -2.2, h: 26, r: 1.5 },
    { x: 4.9, z: -2.6, h: 28, r: 1.7 },
    { x: -5.6, z: 3.2, h: 24, r: 1.3 },
    { x: 6.0, z: 4.0, h: 26, r: 1.4 },
    { x: 0.8, z: 6.8, h: 25, r: 1.6 },
  ];
  let guard = 0;
  while (trees.length < 34 && guard++ < 4000) {
    const a = r() * Math.PI * 2;
    const d = 7 + r() * 26;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    if (!clearOfPlay(x, z)) continue;
    if (trees.some((t) => Math.hypot(t.x - x, t.z - z) < 3.4)) continue;
    trees.push({ x, z, h: 18 + r() * 12, r: 0.6 + r() * 0.9 });
  }
  const canopy: [number, number, number, number, number][] = [];
  trees.forEach((t, i) => {
    barkB.add(trunkGeo(i * 3.1, t.h, t.r), t.x, -0.2, t.z, 0, r() * 6, 0, 1, 1, 1, 0xffffff, [3, t.h / 4]);
    // Branches reaching out high up.
    const nb = 2 + Math.floor(r() * 3);
    for (let k = 0; k < nb; k++) {
      const a = r() * Math.PI * 2;
      const y0 = t.h * (0.45 + r() * 0.35);
      const len = 3 + r() * 5;
      const a0 = new Vector3(t.x, y0, t.z);
      const end = new Vector3(t.x + Math.cos(a) * len, y0 + 1.5 + r() * 3, t.z + Math.sin(a) * len);
      const mid = a0.clone().lerp(end, 0.5).add(new Vector3(0, -0.6, 0));
      barkB.add(new TubeGeometry(new CatmullRomCurve3([a0, mid, end]), 8, t.r * 0.22, 6, false), 0, 0, 0, 0, 0, 0, 1, 1, 1, 0xd8d8d8);
      for (let j = 0; j < 4; j++) canopy.push([end.x + (r() - 0.5) * 3, end.y + (r() - 0.2) * 2, end.z + (r() - 0.5) * 3, 3 + r() * 3, r() * 6]);
    }
    for (let j = 0; j < 3; j++) canopy.push([t.x + (r() - 0.5) * 4, t.h * (0.8 + r() * 0.25), t.z + (r() - 0.5) * 4, 4 + r() * 3, r() * 6]);
    // Surface roots snaking away.
    if (i < 5) {
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2 + r();
        const pts = [new Vector3(t.x + Math.cos(a) * t.r * 1.2, 0.5, t.z + Math.sin(a) * t.r * 1.2)];
        for (let s = 1; s <= 3; s++) pts.push(new Vector3(t.x + Math.cos(a + s * 0.15) * (t.r * 1.2 + s * 0.9), 0.35 - s * 0.12, t.z + Math.sin(a + s * 0.15) * (t.r * 1.2 + s * 0.9)));
        barkB.add(new TubeGeometry(new CatmullRomCurve3(pts), 10, 0.16 - k * 0.012, 6, false), 0, 0, 0);
      }
    }
  });

  // Canopy: ragged leaf clusters (alpha cards, two crossed per cluster).
  const leafMat = new MeshBasicMaterial({ map: leafTex(), alphaTest: 0.5, side: DoubleSide, color: 0x9ad8e0 });
  const leaves = new InstancedMesh(new PlaneGeometry(1, 1), leafMat, canopy.length * 2);
  const m4 = new Matrix4();
  const q = new Quaternion();
  const sv = new Vector3();
  const pv = new Vector3();
  canopy.forEach(([x, y, z, s, a], i) => {
    for (let k = 0; k < 2; k++) {
      q.setFromAxisAngle(new Vector3(0, 1, 0), a + k * 1.57).multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -0.9 + k * 0.4));
      leaves.setMatrixAt(i * 2 + k, m4.compose(pv.set(x, y, z), q, sv.set(s * 1.4, s, 1)));
    }
  });
  leaves.instanceMatrix.needsUpdate = true;

  // --- Mushrooms -----------------------------------------------------------------
  const spotsT = (() => {
    const [c, ctx] = canvas(256, 128);
    const g = ctx.createLinearGradient(0, 0, 0, 128);
    g.addColorStop(0, '#f6c4c8');
    g.addColorStop(0.6, '#e8848e');
    g.addColorStop(1, '#ffb070');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 128);
    const rr = rng(5);
    for (let k = 0; k < 40; k++) {
      ctx.fillStyle = `rgba(255,240,236,${0.5 + rr() * 0.4})`;
      ctx.beginPath();
      ctx.arc(rr() * 256, rr() * 90, 2 + rr() * 6, 0, Math.PI * 2);
      ctx.fill();
    }
    return toTex(c);
  })();
  const gillT = (() => {
    const [c, ctx] = canvas(256, 64);
    ctx.fillStyle = '#ffb060';
    ctx.fillRect(0, 0, 256, 64);
    ctx.strokeStyle = 'rgba(160,50,20,0.55)';
    for (let x = 0; x < 256; x += 4) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 64);
      ctx.stroke();
    }
    const g = ctx.createLinearGradient(0, 0, 0, 64);
    g.addColorStop(0, 'rgba(255,240,200,0.6)');
    g.addColorStop(1, 'rgba(255,240,200,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 64);
    return toTex(c);
  })();
  const capProfile = lathe([0.0, 0.62, 0.3, 0.6, 0.62, 0.48, 0.88, 0.26, 1.0, 0.05, 0.96, 0.0], 22);
  const gillProfile = lathe([0.96, 0.0, 0.6, 0.06, 0.2, 0.14, 0.08, 0.16], 22);
  const stemProfile = lathe([0.0, 0, 0.17, 0, 0.13, 0.12, 0.1, 0.5, 0.09, 0.92, 0.12, 1.0, 0.0, 1.0], 12);
  const caps = new Batch(new MeshBasicMaterial({ map: spotsT, vertexColors: true }));
  const gills = new Batch(new MeshBasicMaterial({ map: gillT, side: DoubleSide }));
  const stems = new Batch(new MeshBasicMaterial({ color: 0xf2e2d0, vertexColors: true }));
  const shroomGlow: number[] = [];
  const addShroom = (x: number, z: number, s: number, lean = 0) => {
    const h = s * (1.4 + r() * 0.8);
    stems.add(stemProfile, x, 0, z, lean, 0, lean * 0.5, s * 0.9, h, s * 0.9);
    const cx = x + Math.sin(lean * 0.5) * h * 0.4;
    caps.add(capProfile, cx, h * 0.96, z, lean * 0.3, r() * 6, 0, s, s * (0.7 + r() * 0.3), s);
    gills.add(gillProfile, cx, h * 0.96, z, lean * 0.3, 0, 0, s, s, s);
    shroomGlow.push(cx, h * 0.9, z);
    shroomLights.push({ p: new Vector3(cx, h * 0.8, z), s });
  };
  // Giants near the player, clusters at tree feet, scattered small ones.
  addShroom(-2.2, 0.2, 0.75, 0.15);
  addShroom(-2.9, 1.0, 0.45, -0.1);
  addShroom(2.5, 0.8, 0.9, -0.12);
  addShroom(3.2, 1.6, 0.5, 0.2);
  addShroom(-1.9, 2.8, 0.38, 0.05);
  addShroom(1.6, 3.4, 0.55, -0.08);
  for (const t of trees.slice(0, 12)) {
    const n = 2 + Math.floor(r() * 4);
    for (let k = 0; k < n; k++) {
      const a = r() * Math.PI * 2;
      const d = t.r * 1.8 + r() * 1.2;
      const x = t.x + Math.cos(a) * d;
      const z = t.z + Math.sin(a) * d;
      if (!clearOfPlay(x, z, false) && Math.hypot(x, z) < 1.8) continue;
      addShroom(x, z, 0.12 + r() * 0.35, (r() - 0.5) * 0.4);
    }
  }
  guard = 0;
  while (shroomLights.length < 70 && guard++ < 2000) {
    const a = r() * Math.PI * 2;
    const d = 2 + r() * 14;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    if (!clearOfPlay(x, z, false) || (z < WALL_Z && Math.abs(x) < 4)) continue;
    addShroom(x, z, 0.08 + r() * 0.2, (r() - 0.5) * 0.5);
  }
  for (const l of shroomLights) env.lights.push({ p: l.p, color: 0xff8a6a, k: 0.9 + l.s * 1.2, r: 1.2 + l.s * 4 });
  // The tunnel mouth's cold blue light.
  env.lights.push({ p: new Vector3(-7.5, 1.0, 1.4), color: 0x4ab8ff, k: 1.8, r: 5 });
  // Glow on the stone tablet from the player's candle side.
  env.lights.push({ p: new Vector3(0, 1.5, 0), color: 0xffb070, k: 0.5, r: 4 });

  // --- The stone tablet: the shadow wall's frame of standing stones and roots --
  const rockT = stoneTex({ seed: 403, base: [98, 104, 96], vary: 0.5, tint2: [54, 92, 58], tint2Amt: 0.5, cracks: 8 });
  const rocks = new Batch(bakedMat(rockT));
  for (const sx of [-1, 1]) {
    rocks.add(rock(sx * 2 + 5, 2, 0.18, 1), sx * 4.0, 2.0, WALL_Z - 0.2, 0, sx * 0.3, sx * 0.05, 0.75, 2.6, 0.7);
    rocks.add(rock(sx * 3 + 9, 1, 0.3), sx * 4.7, 0.3, WALL_Z + 0.4, 0, 0, 0, 0.8, 0.5, 0.7);
  }
  // A lintel stone across the top.
  rocks.add(rock(41, 2, 0.15), 0, 4.65, WALL_Z - 0.15, 0, 0, 0.02, 4.6, 0.55, 0.6);
  // Boulders scattered in the wood, and the rocky tunnel mouth.
  for (let k = 0; k < 26; k++) {
    const a = r() * Math.PI * 2;
    const d = 4 + r() * 22;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    if (!clearOfPlay(x, z)) continue;
    const s = 0.3 + r() * 1.2;
    rocks.add(rock(k, 1, 0.3), x, s * 0.3, z, 0, r() * 6, 0, s * 1.3, s * 0.8, s);
  }
  for (let k = 0; k < 9; k++) {
    const a = (k / 8) * Math.PI;
    rocks.add(rock(k + 60, 1, 0.3), -7.6, Math.sin(a) * 2.2, 1.4 + Math.cos(a) * 1.8, 0, k, 0, 0.8, 0.8, 0.8);
  }
  const tunnelHole = new Mesh(new SphereGeometry(1.5, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), new MeshBasicMaterial({ color: 0x01060c }));
  tunnelHole.scale.set(0.25, 1.35, 1.1);
  tunnelHole.position.set(-7.75, 0, 1.4);
  root.add(tunnelHole, glowCards([[-7.3, 1.0, 1.4, 2.6]], 0x3aa8ff, 0.6));

  // Roots and vines gripping the tablet's edges.
  const vines = new Batch(bakedMat(barkTex(404), { color: 0x9aa890 }));
  for (const sx of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      const pts = [
        new Vector3(sx * (4.6 + k * 0.3), -0.1, WALL_Z - 0.3),
        new Vector3(sx * (3.7 - k * 0.12), 1.2 + k * 0.6, WALL_Z + 0.05),
        new Vector3(sx * (3.45 + k * 0.05), 2.8 + k * 0.4, WALL_Z + 0.06),
        new Vector3(sx * (3.0 - k * 0.6), 4.35 + k * 0.08, WALL_Z + 0.04),
        new Vector3(sx * (1.6 - k * 0.5), 4.7 + k * 0.2, WALL_Z - 0.1),
      ];
      vines.add(new TubeGeometry(new CatmullRomCurve3(pts), 40, 0.09 - k * 0.018, 6, false), 0, 0, 0);
    }
  }
  // Ferns: crossed cards around trees and rocks.
  const fernMat = new MeshBasicMaterial({ map: fernTex(), alphaTest: 0.4, side: DoubleSide, vertexColors: true });
  const ferns = new Batch(fernMat);
  const fernCard = new PlaneGeometry(0.6, 1.1);
  fernCard.translate(0, 0.55, 0);
  guard = 0;
  let nFern = 0;
  while (nFern < 110 && guard++ < 3000) {
    const a = r() * Math.PI * 2;
    const d = 1.9 + r() * 16;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    if (!clearOfPlay(x, z, false) || (z < WALL_Z - 0.3 && Math.abs(x) < 3.6)) continue;
    const s = 0.6 + r() * 0.9;
    for (let k = 0; k < 3; k++) ferns.add(fernCard, x, 0, z, -0.35, a + (k * Math.PI * 2) / 3, 0, s, s, s);
    nFern++;
  }

  root.add(ground.build(env), barkB.build(env), rocks.build(env), vines.build(env), ferns.build(env), caps.build(env), stems.build(env), gills.build(), leaves);
  // Warm halos under the caps (light pooling on the moss).
  root.add(glowPoints(shroomGlow, 0xff8a60, 0.55, 0.32));

  // Blue glow-bulb plants: tiny cyan lights in clumps on the forest floor.
  const bulbs: number[] = [];
  for (let k = 0; k < 60; k++) {
    const a = r() * Math.PI * 2;
    const d = 2 + r() * 12;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    if (!clearOfPlay(x, z, false)) continue;
    for (let j = 0; j < 5; j++) bulbs.push(x + (r() - 0.5) * 0.4, 0.1 + r() * 0.35, z + (r() - 0.5) * 0.4);
  }
  root.add(glowPoints(bulbs, 0x5af0ff, 0.07, 0.95), glowPoints(bulbs, 0x2ab0ff, 0.3, 0.18));

  // Moonbeams slanting down through the canopy.
  for (const [x, z] of [[-3, 3.5], [3.4, 5.5], [-7, -4], [6, -6], [0, 9]]) {
    root.add(lightShaft(new Vector3(x + 2, 22, z - 2), new Vector3(x, 0, z), 0.4, 1.6, 0x7ad0ff, 0.07));
  }
  // Low mist drifting between the trunks.
  const mistCards: [number, number, number, number][] = [];
  for (let k = 0; k < 36; k++) {
    const a = r() * Math.PI * 2;
    const d = 3 + r() * 16;
    mistCards.push([Math.cos(a) * d, 0.35 + r() * 0.5, Math.sin(a) * d, 3 + r() * 4]);
  }
  const mist = glowCards(mistCards, 0x3a8aa0, 0.12);
  root.add(mist);

  // Fireflies: drift on their own, swarm toward the player's hands.
  const count = 320;
  const fly: number[] = [];
  const home: Vector3[] = [];
  for (let k = 0; k < count; k++) {
    const v = new Vector3((r() - 0.5) * 14, 0.3 + r() * 5, -5 + r() * 12);
    home.push(v);
    fly.push(v.x, v.y, v.z);
  }
  const flies = glowPoints(fly, 0x8ff8ff, 0.07);
  const flyHalo = glowPoints(fly, 0x2ad0ff, 0.28, 0.25);
  flyHalo.geometry = flies.geometry;
  root.add(flies, flyHalo);
  const pos = flies.geometry.attributes.position;
  // Big soft bokeh motes high up in the canopy.
  const bokeh: number[] = [];
  for (let k = 0; k < 60; k++) bokeh.push((r() - 0.5) * 30, 5 + r() * 12, (r() - 0.5) * 30);
  root.add(glowPoints(bokeh, 0x6ae8ff, 0.5, 0.35));

  // The tablet's face: pale old stone with moss creeping in from the edges and carved spirals.
  const tablet = wallSurface(405, [200, 206, 192], 0.18, (ctx, w, h) => {
    const n = noiseField(128, 406, 4, 4);
    for (let y = 0; y < h; y += 4) {
      for (let x = 0; x < w; x += 4) {
        const edge = Math.min(x / w, 1 - x / w, y / h, 1 - y / h);
        const m = n[((y >> 3) & 127) * 128 + ((x >> 3) & 127)];
        const a = Math.max(0, Math.min(1, (m - edge * 3.2 - 0.05) * 3));
        if (a > 0.02) {
          ctx.fillStyle = `rgba(60,110,60,${a * 0.85})`;
          ctx.fillRect(x, y, 4, 4);
        }
      }
    }
    ctx.strokeStyle = 'rgba(70,80,70,0.35)';
    ctx.lineWidth = 5;
    for (const [cx, cy] of [[60, 60], [w - 60, 60], [60, h - 60], [w - 60, h - 60]]) {
      ctx.beginPath();
      for (let a = 0; a < 14; a += 0.2) ctx.lineTo(cx + Math.cos(a) * a * 3, cy + Math.sin(a) * a * 3);
      ctx.stroke();
    }
  });

  let pulse = 0;
  const glowMat = gills.material as MeshBasicMaterial;
  void AdditiveBlending;
  void soft;
  return {
    root,
    look: { wallTint: 0xd8e8d8, wallMap: tablet, hemiSky: 0x3a7a90, hemiGround: 0x0a140a, hemiIntensity: 0.6, fog: new FogExp2(0x061a22, 0.036) },
    envLights: [[0, 18, 0, 0x6ab8ff, 3], [-2, 1, 0, 0xff8a6a, 4], [2.5, 1, 1, 0xff8a6a, 4]],
    react: () => (pulse = 1),
    update(dt, t, hands) {
      pulse = Math.max(0, pulse - dt * 0.7);
      glowMat.color.setRGB(1 + pulse * 0.6, 1 + pulse * 0.3, 1);
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
          x += x * pulse * 0.15;
          y += pulse * 0.3;
        }
        pos.setXYZ(k, x, y, z);
      }
      pos.needsUpdate = true;
      mist.rotation.y = Math.sin(t * 0.03) * 0.05;
    },
  };
}
