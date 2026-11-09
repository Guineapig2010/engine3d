// Multi-part STL handling: when the stages (and/or nose cone) of a rocket are
// exported side by side as separate parts — the usual 3D-printing layout — this
// module finds each part, works out what it is (booster, sustainer, nose cone,
// body section), orients it, seats coupler stubs/shoulders into the part above
// and produces one stacked rocket plus the stage separation stations.

import { analyzeRocket } from './geometry.js';

/** Split a triangle soup into connected components (shared/welded vertices). */
export function connectedComponents(positions) {
  const nTri = Math.floor(positions.length / 9);
  let maxExt = 0;
  {
    const mn = [Infinity, Infinity, Infinity];
    const mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < positions.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        mn[k] = Math.min(mn[k], positions[i + k]);
        mx[k] = Math.max(mx[k], positions[i + k]);
      }
    }
    maxExt = Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) || 1;
  }
  const q = maxExt * 1e-5;
  const ids = new Map();
  const parent = new Int32Array(nTri);
  for (let i = 0; i < nTri; i++) parent[i] = i;
  const find = (x) => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  for (let t = 0; t < nTri; t++) {
    for (let v = 0; v < 3; v++) {
      const o = t * 9 + v * 3;
      const key = `${Math.round(positions[o] / q)},${Math.round(positions[o + 1] / q)},${Math.round(positions[o + 2] / q)}`;
      const prev = ids.get(key);
      if (prev === undefined) ids.set(key, t);
      else {
        const a = find(prev);
        const b = find(t);
        if (a !== b) parent[a] = b;
      }
    }
  }
  const groups = new Map();
  for (let t = 0; t < nTri; t++) {
    const r = find(t);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(t);
  }
  return [...groups.values()];
}

function lateralStats(positions, tris, ai) {
  const ui = (ai + 1) % 3;
  const vi = (ai + 2) % 3;
  const mn = [Infinity, Infinity, Infinity];
  const mx = [-Infinity, -Infinity, -Infinity];
  let area = 0;
  let cu = 0;
  let cv = 0;
  for (const t of tris) {
    const o = t * 9;
    const p = [];
    for (let v = 0; v < 3; v++) {
      const q = [positions[o + v * 3], positions[o + v * 3 + 1], positions[o + v * 3 + 2]];
      p.push(q);
      for (let k = 0; k < 3; k++) {
        mn[k] = Math.min(mn[k], q[k]);
        mx[k] = Math.max(mx[k], q[k]);
      }
    }
    const e1 = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]];
    const e2 = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
    const A = 0.5 * Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]);
    area += A;
    cu += ((p[0][ui] + p[1][ui] + p[2][ui]) / 3) * A;
    cv += ((p[0][vi] + p[1][vi] + p[2][vi]) / 3) * A;
  }
  cu /= area || 1;
  cv /= area || 1;
  const sizeU = mx[ui] - mn[ui];
  const sizeV = mx[vi] - mn[vi];
  return { area, cu, cv, sizeU, sizeV, axial: mx[ai] - mn[ai], mn, mx, ui, vi };
}

function minLateralDist(positions, tris, ui, vi, cu, cv) {
  let d = Infinity;
  for (const t of tris) {
    for (let v = 0; v < 3; v++) {
      const o = t * 9 + v * 3;
      d = Math.min(d, Math.hypot(positions[o + ui] - cu, positions[o + vi] - cv));
    }
  }
  return d;
}

function medianLateralDist(positions, tris, ui, vi, cu, cv) {
  const ds = [];
  for (const t of tris) {
    for (let v = 0; v < 3; v++) {
      const o = t * 9 + v * 3;
      ds.push(Math.hypot(positions[o + ui] - cu, positions[o + vi] - cv));
    }
  }
  ds.sort((a, b) => a - b);
  // 90th percentile: a finely meshed nose cone would drag a median far below the body radius
  return ds[Math.floor(ds.length * 0.9)] || 0;
}

/** Group components into upright "columns" (one per physical part) for an axis. */
function columnsForAxis(positions, comps, ai) {
  const stats = comps.map((tris) => ({ tris, ...lateralStats(positions, tris, ai) }));
  const ui = (ai + 1) % 3;
  const vi = (ai + 2) % 3;
  for (const s of stats) {
    const aspect = Math.min(s.sizeU, s.sizeV) / (Math.max(s.sizeU, s.sizeV) || 1);
    // round in cross-section AND with some length along the axis (a fin seen face-on is round-ish but flat)
    s.core = aspect > 0.55 && s.axial > 0.25 * Math.max(s.sizeU, s.sizeV);
  }
  const order = [...stats].sort((a, b) => (a.core === b.core ? b.area - a.area : a.core ? -1 : 1));
  const cols = [];
  for (const s of order) {
    let best = null;
    let bestD = Infinity;
    for (const c of cols) {
      const d = minLateralDist(positions, s.tris, ui, vi, c.cu, c.cv);
      if (d < c.radius * 1.3 + c.radius * 0.1 + 1e-9 && d < bestD) {
        best = c;
        bestD = d;
      }
    }
    if (!best && !s.core && cols.length) {
      // a fin floating free: attach to the nearest column
      for (const c of cols) {
        const d = minLateralDist(positions, s.tris, ui, vi, c.cu, c.cv);
        if (d < bestD) {
          best = c;
          bestD = d;
        }
      }
    }
    if (best) {
      best.tris.push(...s.tris);
      best.hasCore ||= s.core;
    } else {
      cols.push({ cu: s.cu, cv: s.cv, radius: Math.max(1e-9, medianLateralDist(positions, s.tris, ui, vi, s.cu, s.cv)), tris: [...s.tris], hasCore: s.core });
    }
  }
  return cols;
}

function subPositions(positions, tris) {
  const out = new Float32Array(tris.length * 9);
  tris.forEach((t, i) => out.set(positions.subarray ? positions.subarray(t * 9, t * 9 + 9) : positions.slice(t * 9, t * 9 + 9), i * 9));
  return out;
}

/**
 * Detect separated parts. Returns null when the STL is a single assembled rocket.
 * Otherwise returns { axis, parts: [...] } where each part has its own analysis.
 */
export function detectParts(positions, { unitScale = 0.001, axis = 'auto' } = {}) {
  const nTri = positions.length / 9;
  if (nTri > 3e6) return null;
  const comps = connectedComponents(positions);
  if (comps.length < 2 || comps.length > 4000) return null;
  const axes = axis === 'auto' ? [0, 1, 2] : [{ x: 0, y: 1, z: 2 }[axis]];
  let best = null;
  for (const ai of axes) {
    const cols = columnsForAxis(positions, comps, ai);
    if (cols.length < 2 || cols.length > 8) continue;
    // each part of a rocket has a round body tube or nose; thin fins alone don't count
    if (!cols.every((c) => c.hasCore)) continue;
    // every part should be long along this axis (rockets are slender)
    let score = 0;
    let ok = true;
    for (const c of cols) {
      const st = lateralStats(positions, c.tris, ai);
      const lat = Math.max(st.sizeU, st.sizeV) || 1;
      if (st.axial < 0.3 * lat) ok = false;
      score += st.axial / lat;
    }
    if (!ok) continue;
    if (!best || score > best.score) best = { ai, cols, score };
  }
  if (!best) return null;
  const axisName = 'xyz'[best.ai];
  const parts = best.cols.map((c, i) => {
    const pos = subPositions(positions, c.tris);
    const geom = analyzeRocket(pos, { unitScale, axis: axisName, slices: 160 });
    const L = geom.length;
    const R = geom.refRadius;
    const hasFins = geom.finSets.length > 0;
    const tip = geom.rb[0] < 0.35 * R && geom.noseLength > 1.2 * geom.refDiameter;
    // coupler stub / shoulder at the top end (x from 0 = top)
    let topStub = 0;
    if (!tip) {
      for (let k = 0; k < geom.nSlices; k++) {
        if (geom.rb[k] >= 0.985 * R) break;
        topStub = geom.xs[k] + geom.dx / 2;
      }
      if (topStub > 0.6 * L) topStub = 0;
    }
    let bottomStub = 0;
    {
      let k = geom.nSlices - 1;
      while (k > 0 && geom.rb[k] <= 0) k--; // fins hanging below the body
      const bodyEnd = geom.xs[k] + geom.dx / 2;
      let start = bodyEnd;
      for (; k >= 0; k--) {
        if (geom.rb[k] >= 0.985 * R) break;
        start = geom.xs[k] - geom.dx / 2;
      }
      bottomStub = bodyEnd - start;
      if (bottomStub > 0.6 * L) bottomStub = 0;
    }
    const finSize = geom.finSets.reduce((a, f) => Math.max(a, f.count * f.area), 0);
    const role = hasFins ? (tip ? 'sustainer' : 'booster') : tip ? 'nose' : 'body';
    // raw lateral centre (file layout) for the "laid out" pose
    const st = lateralStats(positions, c.tris, best.ai);
    return { index: i, positions: pos, geom, hasFins, tip, topStub, bottomStub, finSize, role, layout: { u: st.cu * unitScale, v: st.cv * unitScale, base: st.mn[best.ai] * unitScale } };
  });
  return { axis: axisName, parts };
}

/** Default bottom-to-top order for detected parts. */
export function defaultOrder(parts) {
  const finned = parts.filter((p) => p.hasFins);
  const tipFinned = finned.filter((p) => p.tip);
  const others = finned.filter((p) => !p.tip).sort((a, b) => b.finSize - a.finSize || b.geom.length - a.geom.length);
  const body = parts.filter((p) => !p.hasFins && !p.tip);
  const nose = parts.filter((p) => !p.hasFins && p.tip);
  return [...others, ...tipFinned, ...body, ...nose].map((p) => p.index);
}

/**
 * Stack the parts in the given bottom→top order. Returns combined positions in
 * the rocket frame (metres, +Y toward the nose, tail at y = 0), per-part
 * geometry for rendering and stage separation stations.
 */
export function assembleParts(detected, order = defaultOrder(detected.parts)) {
  const parts = order.map((i) => detected.parts[i]);
  let total = 0;
  for (const p of parts) total += p.positions.length;
  const combined = new Float32Array(total);
  let off = 0;
  let prevTop = null; // body top (joint plane) of the part below
  const placed = [];
  const stations = [];
  let finnedSeen = 0;
  for (const p of parts) {
    const g = p.geom;
    const m = g.matrix;
    const bodyBottom = g.bodyAftY + p.bottomStub; // joint plane, part-local
    const y0 = prevTop === null ? 0 : prevTop - bodyBottom;
    if (p.hasFins) {
      if (finnedSeen > 0) stations.push(y0 + bodyBottom);
      finnedSeen++;
    }
    const local = new Float32Array(p.positions.length);
    const src = p.positions;
    for (let i = 0; i < src.length; i += 3) {
      const x = src[i];
      const y = src[i + 1];
      const z = src[i + 2];
      local[i] = m[0] * x + m[1] * y + m[2] * z + m[3];
      local[i + 1] = m[4] * x + m[5] * y + m[6] * z + m[7] + y0;
      local[i + 2] = m[8] * x + m[9] * y + m[10] * z + m[11];
    }
    combined.set(local, off);
    off += local.length;
    placed.push({ part: p, y0, positions: local, role: p.role, length: g.length });
    prevTop = y0 + g.length - p.topStub;
  }
  // Which stage each placed part belongs to (non-finned parts ride with the stage below them).
  let stage = -1;
  for (const pl of placed) {
    if (pl.part.hasFins || stage < 0) stage++;
    pl.stage = Math.max(0, Math.min(stage, Math.max(0, stations.length)));
  }
  return { positions: combined, stations, placed, order };
}

export function describePart(p) {
  const names = { booster: 'Booster', sustainer: 'Sustainer (nose + fins)', nose: 'Nose cone', body: 'Body section' };
  const L = (p.geom.length * 1000).toFixed(0);
  const fins = p.geom.finSets.map((f) => `${f.count} fins`).join(', ');
  return `${names[p.role]} · ${L} mm${fins ? ' · ' + fins : ''}${p.topStub ? ` · ${(p.topStub * 1000).toFixed(0)} mm coupler` : ''}`;
}
