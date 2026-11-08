// STL → rocket model analysis.
//
// Takes a raw triangle soup and works out everything the flight simulator needs:
//   * the rocket's long axis, which end is the nose, and a local frame
//     (local +Y runs from the tail (y = 0) to the nose tip (y = L))
//   * the body radius profile, nose length and reference diameter
//   * fin sets (count, root/tip chord, span, sweep) → Barrowman normal-force
//     slope and centre of pressure, using slender-body theory for the body
//   * surface-area mass distribution (for CG and pitch inertia)
//   * motor-mount tubes visible at the aft end (so motors are placed for you)

const BINS = 90; // angular bins per slice (4°)
const SAMPLES_PER_SEG = 6;

export const STANDARD_MOTOR_DIAMETERS = [10.5, 13, 18, 24, 29, 38];

/**
 * @param {Float32Array|number[]} positions  triangle soup, xyz per vertex
 * @param {object} opts
 *   unitScale  – multiply STL units by this to get metres (mm → 0.001)
 *   axis       – 'auto' | 'x' | 'y' | 'z'
 *   noseAt     – 'auto' | 'max' | 'min' (which end of the axis is the nose)
 *   slices     – number of axial slices
 */
export function analyzeRocket(positions, opts = {}) {
  const unitScale = opts.unitScale ?? 0.001;
  const nSlices = opts.slices ?? 240;
  const nTri = Math.floor(positions.length / 9);
  if (nTri < 4) throw new Error('STL has too few triangles');

  // ---- bounding box & axis ---------------------------------------------
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = positions[i + k] * unitScale;
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  const ext = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  let ai = { x: 0, y: 1, z: 2 }[opts.axis] ?? -1;
  if (ai < 0) ai = ext.indexOf(Math.max(...ext));
  const ui = (ai + 1) % 3;
  const vi = (ai + 2) % 3;

  // ---- lateral centre: area-weighted surface centroid ---------------------
  let areaSum = 0;
  let cu = 0;
  let cv = 0;
  const triArea = new Float64Array(nTri);
  for (let t = 0; t < nTri; t++) {
    const o = t * 9;
    const ax = positions[o] * unitScale, ay = positions[o + 1] * unitScale, az = positions[o + 2] * unitScale;
    const bx = positions[o + 3] * unitScale, by = positions[o + 4] * unitScale, bz = positions[o + 5] * unitScale;
    const cx = positions[o + 6] * unitScale, cy = positions[o + 7] * unitScale, cz = positions[o + 8] * unitScale;
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    const A = 0.5 * Math.sqrt(nx * nx + ny * ny + nz * nz);
    triArea[t] = A;
    areaSum += A;
    const c = [(ax + bx + cx) / 3, (ay + by + cy) / 3, (az + bz + cz) / 3];
    cu += c[ui] * A;
    cv += c[vi] * A;
  }
  cu /= areaSum;
  cv /= areaSum;
  const amin = min[ai];
  const amax = max[ai];
  const L = amax - amin;
  const dA = L / nSlices;

  // ---- slice the mesh ------------------------------------------------------
  // maxR[k*BINS + b] = furthest surface point from the axis in slice k, bin b.
  const maxR = new Float32Array(nSlices * BINS);
  const sliceArea = new Float64Array(nSlices); // shell area per slice (mass model)
  const P = [0, 0, 0];
  const pa = new Float64Array(3);
  const pu = new Float64Array(3);
  const pv = new Float64Array(3);
  const seg = [];
  for (let t = 0; t < nTri; t++) {
    const o = t * 9;
    for (let j = 0; j < 3; j++) {
      pa[j] = positions[o + j * 3 + ai] * unitScale - amin;
      pu[j] = positions[o + j * 3 + ui] * unitScale - cu;
      pv[j] = positions[o + j * 3 + vi] * unitScale - cv;
    }
    // mass distribution by centroid
    const ca = (pa[0] + pa[1] + pa[2]) / 3;
    sliceArea[Math.min(nSlices - 1, Math.max(0, Math.floor(ca / dA)))] += triArea[t];

    const lo = Math.min(pa[0], pa[1], pa[2]);
    const hi = Math.max(pa[0], pa[1], pa[2]);
    const k0 = Math.max(0, Math.ceil(lo / dA - 0.5));
    const k1 = Math.min(nSlices - 1, Math.floor(hi / dA - 0.5));
    for (let k = k0; k <= k1; k++) {
      const plane = (k + 0.5) * dA;
      seg.length = 0;
      for (let e = 0; e < 3; e++) {
        const i0 = e;
        const i1 = (e + 1) % 3;
        const d0 = pa[i0] - plane;
        const d1 = pa[i1] - plane;
        if ((d0 <= 0 && d1 > 0) || (d0 > 0 && d1 <= 0)) {
          const s = d0 / (d0 - d1);
          seg.push(pu[i0] + s * (pu[i1] - pu[i0]), pv[i0] + s * (pv[i1] - pv[i0]));
        }
      }
      if (seg.length < 4) continue;
      for (let s = 0; s <= SAMPLES_PER_SEG; s++) {
        const f = s / SAMPLES_PER_SEG;
        const x = seg[0] + f * (seg[2] - seg[0]);
        const y = seg[1] + f * (seg[3] - seg[1]);
        const r = Math.hypot(x, y);
        let b = Math.floor(((Math.atan2(y, x) + Math.PI) / (2 * Math.PI)) * BINS);
        if (b >= BINS) b = BINS - 1;
        const idx = k * BINS + b;
        if (r > maxR[idx]) maxR[idx] = r;
      }
    }
  }
  void P;

  // ---- per-slice body radius & fin span -------------------------------------
  const rbRaw = new Float64Array(nSlices);
  const rOuter = new Float64Array(nSlices);
  const noBodyA = new Uint8Array(nSlices); // slice holds only fins (e.g. fins overhanging the tail)
  const tmp = [];
  for (let k = 0; k < nSlices; k++) {
    tmp.length = 0;
    let mx = 0;
    for (let b = 0; b < BINS; b++) {
      const r = maxR[k * BINS + b];
      if (r > 0) tmp.push(r);
      if (r > mx) mx = r;
    }
    rOuter[k] = mx;
    if (!tmp.length) continue;
    if (tmp.length < BINS * 0.4) {
      noBodyA[k] = 1;
      continue;
    }
    tmp.sort((a, b) => a - b);
    rbRaw[k] = tmp[Math.floor(tmp.length * 0.45)];
  }
  // Fill interior gaps by interpolation, then median-smooth.
  fillGaps(rbRaw);
  fillGaps(rOuter);
  const rbA = medianFilter(rbRaw, 2);
  // Effective body radius for fin measurements (nearest real body slice).
  const rbEffA = Float64Array.from(rbA);
  {
    let last = 0;
    for (let k = 0; k < nSlices; k++) (rbA[k] > 0 ? (last = rbA[k]) : (rbEffA[k] = last));
    last = 0;
    for (let k = nSlices - 1; k >= 0; k--) (rbA[k] > 0 ? (last = rbA[k]) : (rbEffA[k] = Math.max(rbEffA[k], last)));
  }

  // fin span per slice (raw axial index)
  const finSpanA = new Float64Array(nSlices);
  const finGroupsA = new Int32Array(nSlices);
  for (let k = 0; k < nSlices; k++) {
    const rb = rbEffA[k];
    const thr = rb * 1.15 + 0.0015;
    if (rOuter[k] <= thr) continue;
    finSpanA[k] = rOuter[k] - rb;
  }

  // ---- which end is the nose? ---------------------------------------------
  let noseAtMax;
  if (opts.noseAt === 'max') noseAtMax = true;
  else if (opts.noseAt === 'min') noseAtMax = false;
  else {
    let w = 0;
    let wx = 0;
    for (let k = 0; k < nSlices; k++) {
      w += finSpanA[k];
      wx += finSpanA[k] * k;
    }
    if (w > 0) {
      noseAtMax = wx / w < nSlices / 2; // fins are near the tail
    } else {
      const n = Math.max(2, Math.floor(nSlices * 0.1));
      let s0 = 0;
      let s1 = 0;
      for (let k = 0; k < n; k++) {
        s0 += rbA[k];
        s1 += rbA[nSlices - 1 - k];
      }
      noseAtMax = s1 < s0;
    }
  }

  // Re-index so slice i is measured from the NOSE (x = (i+0.5)*dx from tip).
  const idx = (i) => (noseAtMax ? nSlices - 1 - i : i);
  const rb = new Float64Array(nSlices);
  const rbEff = new Float64Array(nSlices);
  const noBody = new Uint8Array(nSlices);
  const finSpan = new Float64Array(nSlices);
  const meshArea = new Float64Array(nSlices);
  const xs = new Float64Array(nSlices);
  for (let i = 0; i < nSlices; i++) {
    rb[i] = rbA[idx(i)];
    rbEff[i] = rbEffA[idx(i)];
    noBody[i] = noBodyA[idx(i)];
    finSpan[i] = finSpanA[idx(i)];
    meshArea[i] = sliceArea[idx(i)];
    xs[i] = (i + 0.5) * dA;
  }
  const binR = (i, b) => maxR[idx(i) * BINS + b];

  // ---- fin sets --------------------------------------------------------------
  const rRef = Math.max(...rb);
  const finSets = findFinSets({ nSlices, dx: dA, xs, rb: rbEff, noBody, finSpan, binR, rRef });
  for (const f of finSets) {
    for (let i = f.i0; i <= f.i1; i++) finGroupsA[i] = f.count;
  }
  // Outer (wetted) skin area per slice — used for the mass model so that
  // hollow vs. solid CAD models and internal parts don't skew the estimate.
  const shellArea = new Float64Array(nSlices);
  for (let i = 0; i < nSlices; i++) {
    let n = 0;
    for (const f of finSets) if (i >= f.i0 && i <= f.i1) n = f.count;
    shellArea[i] = 2 * Math.PI * rb[i] * dA + 2 * n * finSpan[i] * dA;
  }

  // nose length: from tip until radius reaches 97% of the local max body radius
  let noseLen = 0;
  {
    let peak = 0;
    for (let i = 0; i < nSlices; i++) {
      peak = Math.max(peak, rb[i]);
      if (rb[i] >= 0.97 * rRef) {
        noseLen = xs[i];
        break;
      }
    }
    void peak;
  }

  // ---- local transform (raw STL → rocket frame) --------------------------
  // rows: local x, y (axis, toward nose), z; translation puts the tail at y = 0
  const sgn = noseAtMax ? 1 : -1;
  const ey = [0, 0, 0];
  ey[ai] = sgn;
  const ex = [0, 0, 0];
  ex[ui] = 1;
  const ez = [ex[1] * ey[2] - ex[2] * ey[1], ex[2] * ey[0] - ex[0] * ey[2], ex[0] * ey[1] - ex[1] * ey[0]];
  const c = [0, 0, 0];
  c[ui] = cu;
  c[vi] = cv;
  c[ai] = noseAtMax ? amin : amax; // tail point on axis
  const s = unitScale;
  // local = R * (s*p - c)  →  row-major 3x4 with scale folded in
  const row = (e) => [e[0] * s, e[1] * s, e[2] * s, -(e[0] * c[0] + e[1] * c[1] + e[2] * c[2])];
  const matrix = [...row(ex), ...row(ey), ...row(ez), 0, 0, 0, 1];

  const geom = {
    length: L,
    dx: dA,
    nSlices,
    xs,
    rb,
    finSpan,
    shellArea,
    meshArea,
    surfaceArea: areaSum,
    refRadius: rRef,
    refDiameter: 2 * rRef,
    refArea: Math.PI * rRef * rRef,
    noseLength: noseLen,
    finSets,
    matrix, // row-major 4x4, maps raw STL coords to the rocket frame (metres)
    axisName: 'xyz'[ai],
    noseAtMax,
    triangles: nTri,
    // keep a compact lookup for mount detection at arbitrary stations
    _raw: { positions, unitScale, ai, ui, vi, cu, cv, amin, amax, noseAtMax },
  };
  // Aft end of the body tube (fins may hang past it).
  let lastBody = nSlices - 1;
  while (lastBody > 0 && rb[lastBody] <= 0) lastBody--;
  geom.bodyAftY = Math.max(0, L - (xs[lastBody] + dA / 2));
  geom.motorMounts = detectMotorMounts(geom, geom.bodyAftY);
  return geom;
}

function fillGaps(a) {
  const n = a.length;
  let last = -1;
  for (let i = 0; i < n; i++) {
    if (a[i] > 0) {
      if (last >= 0 && i - last > 1) {
        for (let j = last + 1; j < i; j++) a[j] = a[last] + ((a[i] - a[last]) * (j - last)) / (i - last);
      }
      last = i;
    }
  }
}

function medianFilter(a, r) {
  const out = new Float64Array(a.length);
  const w = [];
  for (let i = 0; i < a.length; i++) {
    w.length = 0;
    for (let j = Math.max(0, i - r); j <= Math.min(a.length - 1, i + r); j++) w.push(a[j]);
    w.sort((x, y) => x - y);
    out[i] = w[w.length >> 1];
  }
  // keep the true tip/tail radii (median would round them off)
  out[0] = a[0];
  out[a.length - 1] = a[a.length - 1];
  return out;
}

function findFinSets({ nSlices, dx, xs, rb, noBody, finSpan, binR, rRef }) {
  // contiguous runs of slices with fin span, merging tiny gaps
  const runs = [];
  let start = -1;
  let gap = 0;
  for (let i = 0; i < nSlices; i++) {
    if (finSpan[i] > 0) {
      if (start < 0) start = i;
      gap = 0;
    } else if (start >= 0) {
      gap++;
      if (gap > 2) {
        runs.push([start, i - gap]);
        start = -1;
        gap = 0;
      }
    }
  }
  if (start >= 0) runs.push([start, nSlices - 1 - gap]);

  const sets = [];
  for (const [i0, i1] of runs) {
    let span = 0;
    for (let i = i0; i <= i1; i++) span = Math.max(span, finSpan[i]);
    if (span < Math.max(0.004, 0.3 * rRef) || i1 - i0 < 1) continue; // launch lug, rail button, etc.
    // count fins: groups of angular bins well above the body at slices with
    // more than half the maximum span
    const counts = new Map();
    for (let i = i0; i <= i1; i++) {
      if (finSpan[i] < 0.5 * span) continue;
      const thr = rb[i] + 0.4 * finSpan[i];
      const above = [];
      for (let b = 0; b < BINS; b++) above.push(binR(i, b) > thr);
      let groups = 0;
      for (let b = 0; b < BINS; b++) if (above[b] && !above[(b + BINS - 1) % BINS]) groups++;
      if (groups === 0 && above.every(Boolean)) groups = 1;
      counts.set(groups, (counts.get(groups) || 0) + 1);
    }
    let count = 0;
    let best = -1;
    for (const [g, n] of counts) if (n > best || (n === best && g > count)) { best = n; count = g; }
    if (count < 2) continue;

    // planform from the span profile: x is distance from nose
    // root chord: fin slices that are attached to the body
    let r0 = -1;
    let r1 = -1;
    for (let i = i0; i <= i1; i++) {
      if (noBody[i]) continue;
      if (r0 < 0) r0 = i;
      r1 = i;
    }
    if (r0 < 0) continue;
    const xRootLE = xs[r0] - dx / 2;
    const xRootTE = xs[r1] + dx / 2;
    const Cr = xRootTE - xRootLE;
    let area = 0;
    let tipLE = null;
    let tipTE = null;
    for (let i = i0; i <= i1; i++) {
      area += finSpan[i] * dx;
      if (finSpan[i] >= 0.95 * span) {
        if (tipLE === null) tipLE = xs[i] - dx / 2;
        tipTE = xs[i] + dx / 2;
      }
    }
    // Equivalent trapezoid with the same area, span and root chord.
    let Ct = Math.max(0, (2 * area) / span - Cr);
    const tipMid = (tipLE + tipTE) / 2;
    let sweep = tipMid - Ct / 2 - xRootLE; // leading-edge sweep distance
    if (!Number.isFinite(sweep)) sweep = 0;
    // Body radius at the fin root (mean over the root)
    let rBody = 0;
    for (let i = i0; i <= i1; i++) rBody += rb[i];
    rBody /= i1 - i0 + 1;
    sets.push({ i0, i1, count, Cr, Ct, span, sweep, xLE: xRootLE, area, rBody });
  }
  return sets;
}

/**
 * Look for motor-mount tubes in a slice a little forward of the given station
 * (aft end of a stage, measured from the tail in metres).
 */
export function detectMotorMounts(geom, stationFromTail = 0) {
  const R = geom._raw;
  const { positions, unitScale, ai, ui, vi, cu, cv, amin, amax, noseAtMax } = R;
  const L = amax - amin;
  const tries = [0.006, 0.012, 0.02, 0.03];
  let best = null;
  for (const off of tries) {
    const yLocal = stationFromTail + Math.max(off, L * 0.004);
    if (yLocal >= L) continue;
    const plane = noseAtMax ? amin + yLocal : amax - yLocal;
    const pts = slicePoints(positions, unitScale, ai, ui, vi, cu, cv, plane);
    const xFromNose = L - yLocal;
    const i = Math.min(geom.nSlices - 1, Math.max(0, Math.floor(xFromNose / geom.dx)));
    const rb = geom.rb[i];
    // convert raw lateral (u, v) to the rocket frame (x = u, z = −v when the nose is at +axis)
    const mounts = findTubes(pts, rb).map((m) => ({ ...m, z: noseAtMax ? -m.z : m.z }));
    if (mounts.length && (!best || mounts.length > best.length)) best = mounts;
    if (best && best.length) break;
  }
  return best || [];
}

function slicePoints(positions, s, ai, ui, vi, cu, cv, plane) {
  const out = [];
  const n = positions.length / 9;
  const a = [0, 0, 0];
  const u = [0, 0, 0];
  const v = [0, 0, 0];
  for (let t = 0; t < n; t++) {
    const o = t * 9;
    let lo = Infinity;
    let hi = -Infinity;
    for (let j = 0; j < 3; j++) {
      a[j] = positions[o + j * 3 + ai] * s;
      if (a[j] < lo) lo = a[j];
      if (a[j] > hi) hi = a[j];
    }
    if (plane < lo || plane > hi) continue;
    for (let j = 0; j < 3; j++) {
      u[j] = positions[o + j * 3 + ui] * s - cu;
      v[j] = positions[o + j * 3 + vi] * s - cv;
    }
    const segp = [];
    for (let e = 0; e < 3; e++) {
      const i0 = e;
      const i1 = (e + 1) % 3;
      const d0 = a[i0] - plane;
      const d1 = a[i1] - plane;
      if ((d0 <= 0 && d1 > 0) || (d0 > 0 && d1 <= 0)) {
        const f = d0 / (d0 - d1);
        segp.push([u[i0] + f * (u[i1] - u[i0]), v[i0] + f * (v[i1] - v[i0])]);
      }
    }
    if (segp.length < 2) continue;
    const len = Math.hypot(segp[1][0] - segp[0][0], segp[1][1] - segp[0][1]);
    const k = Math.min(20, Math.max(1, Math.ceil(len / 0.0008)));
    for (let j = 0; j <= k; j++) {
      const f = j / k;
      out.push([segp[0][0] + f * (segp[1][0] - segp[0][0]), segp[0][1] + f * (segp[1][1] - segp[0][1])]);
    }
  }
  return out;
}

function findTubes(pts, rb) {
  // points clearly inside the body tube wall
  const inner = pts.filter(([x, y]) => {
    const r = Math.hypot(x, y);
    return r < 0.86 * rb;
  });
  if (inner.length < 12) inner.length = 0; // nothing inside: may still be minimum diameter
  // grid-hash connected components (link distance 2.5 mm)
  const link = 0.0025;
  const cell = new Map();
  const key = (x, y) => `${Math.floor(x / link)},${Math.floor(y / link)}`;
  inner.forEach((p, i) => {
    const k = key(p[0], p[1]);
    if (!cell.has(k)) cell.set(k, []);
    cell.get(k).push(i);
  });
  const comp = new Int32Array(inner.length).fill(-1);
  let nComp = 0;
  for (let i = 0; i < inner.length; i++) {
    if (comp[i] >= 0) continue;
    const stack = [i];
    comp[i] = nComp;
    while (stack.length) {
      const j = stack.pop();
      const [x, y] = inner[j];
      const cx = Math.floor(x / link);
      const cy = Math.floor(y / link);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const list = cell.get(`${cx + dx},${cy + dy}`);
          if (!list) continue;
          for (const q of list) {
            if (comp[q] >= 0) continue;
            if (Math.hypot(inner[q][0] - x, inner[q][1] - y) <= link) {
              comp[q] = nComp;
              stack.push(q);
            }
          }
        }
      }
    }
    nComp++;
  }
  const tubes = [];
  for (let c = 0; c < nComp; c++) {
    const p = inner.filter((_, i) => comp[i] === c);
    if (p.length < 12) continue;
    let mx = 0;
    let my = 0;
    for (const q of p) {
      mx += q[0];
      my += q[1];
    }
    mx /= p.length;
    my /= p.length;
    const d = p.map((q) => Math.hypot(q[0] - mx, q[1] - my)).sort((a, b) => a - b);
    // must be ring-like: points all roughly the same distance from the centre
    const rIn = d[Math.floor(d.length * 0.1)];
    const rOut = d[Math.floor(d.length * 0.9)];
    if (rIn < 0.003 || rOut - rIn > 0.35 * rIn + 0.0015) continue;
    // angular coverage check (closed ring)
    const seen = new Set(p.map((q) => Math.floor(((Math.atan2(q[1] - my, q[0] - mx) + Math.PI) / (2 * Math.PI)) * 12)));
    if (seen.size < 10) continue;
    const diaMM = rIn * 2000;
    const snapped = STANDARD_MOTOR_DIAMETERS.reduce((a, b) => (Math.abs(b - diaMM) < Math.abs(a - diaMM) ? b : a));
    tubes.push({
      x: mx,
      z: my,
      innerDiameter: diaMM,
      motorDiameter: Math.abs(snapped - diaMM) <= 1.6 ? snapped : Math.round(diaMM),
    });
  }
  if (!tubes.length) {
    // Minimum-diameter rocket: the body tube itself is the motor tube.
    const wall = pts.filter(([x, y]) => {
      const r = Math.hypot(x, y);
      return r > 0.8 * rb && r < 0.995 * rb;
    });
    if (wall.length > 24) {
      const rs = wall.map(([x, y]) => Math.hypot(x, y)).sort((a, b) => a - b);
      const rIn = rs[Math.floor(rs.length * 0.1)];
      const seen = new Set(wall.map(([x, y]) => Math.floor(((Math.atan2(y, x) + Math.PI) / (2 * Math.PI)) * 12)));
      const diaMM = rIn * 2000;
      const snapped = STANDARD_MOTOR_DIAMETERS.reduce((a, b) => (Math.abs(b - diaMM) < Math.abs(a - diaMM) ? b : a));
      if (seen.size >= 11 && Math.abs(snapped - diaMM) <= 1.0) {
        tubes.push({ x: 0, z: 0, innerDiameter: diaMM, motorDiameter: snapped, minimumDiameter: true });
      }
    }
  }
  // drop tubes that contain other tubes (e.g. the body tube inner wall)
  return tubes.filter((t) => !tubes.some((o) => o !== t && Math.hypot(o.x - t.x, o.z - t.z) + o.innerDiameter / 2000 < t.innerDiameter / 2000));
}

// ---------------------------------------------------------------------------
// Aerodynamics (Barrowman + slender body) for a section of the rocket.
// xTop/xBottom are distances from the nose tip; the stack always includes the nose.
// ---------------------------------------------------------------------------
export function aeroForSection(geom, xBottom = geom.length) {
  const { xs, rb, dx, refArea } = geom;
  let cna = 0;
  let moment = 0;
  let prevA = 0;
  const parts = [];
  let bodyCna = 0;
  let bodyMom = 0;
  for (let i = 0; i < geom.nSlices; i++) {
    const xEnd = xs[i] + dx / 2;
    if (xEnd > xBottom + 1e-9) break;
    if (rb[i] <= 0) continue; // fins hanging past the tail: no body here
    const A = Math.PI * rb[i] * rb[i];
    const dCna = (2 * (A - prevA)) / refArea;
    // centroid of dA/dx over the slice is near its centre
    bodyCna += dCna;
    bodyMom += dCna * (xs[i] - dx * 0.0);
    prevA = A;
  }
  parts.push({ name: 'Body (nose, transitions)', cna: bodyCna, x: bodyCna ? bodyMom / bodyCna : 0 });
  cna += bodyCna;
  moment += bodyMom;

  const d = geom.refDiameter;
  for (const f of geom.finSets) {
    const xMid = f.xLE + f.Cr / 2;
    if (xMid > xBottom) continue;
    const { Cr, Ct, span: s, sweep, count: N, rBody } = f;
    const Lm = Math.sqrt(s * s + Math.pow(sweep + Ct / 2 - Cr / 2, 2));
    let cnaF = (4 * N * Math.pow(s / d, 2)) / (1 + Math.sqrt(1 + Math.pow((2 * Lm) / (Cr + Ct), 2)));
    // Barrowman's N-fin formula is for 3 or 4 fins; more fins interfere.
    if (N > 4) cnaF *= N === 5 ? 0.948 : N === 6 ? 0.913 : N === 7 ? 0.854 : 0.81;
    const Kfb = 1 + rBody / (s + rBody);
    cnaF *= Kfb;
    const xf =
      f.xLE +
      (sweep / 3) * ((Cr + 2 * Ct) / (Cr + Ct)) +
      (1 / 6) * (Cr + Ct - (Cr * Ct) / (Cr + Ct));
    parts.push({ name: `${N} fins @ ${(f.xLE * 1000).toFixed(0)} mm`, cna: cnaF, x: xf });
    cna += cnaF;
    moment += cnaF * xf;
  }
  return { cna, xcp: cna > 0 ? moment / cna : xBottom, parts };
}

/** Wetted areas etc. for the drag model over [0, xBottom]. */
export function dragGeometry(geom, xBottom = geom.length) {
  let wetBody = 0;
  let baseR = 0;
  let maxR = 0;
  for (let i = 0; i < geom.nSlices; i++) {
    if (geom.xs[i] + geom.dx / 2 > xBottom + 1e-9) break;
    const r = geom.rb[i];
    if (r <= 0) continue;
    const rPrev = i > 0 ? geom.rb[i - 1] : 0;
    wetBody += Math.PI * (r + rPrev) * Math.sqrt(geom.dx * geom.dx + (r - rPrev) * (r - rPrev));
    baseR = r;
    maxR = Math.max(maxR, r);
  }
  let wetFins = 0;
  let finFrontal = 0;
  let meanChord = 0;
  let nFinSets = 0;
  for (const f of geom.finSets) {
    if (f.xLE + f.Cr / 2 > xBottom) continue;
    wetFins += 2 * f.count * f.area;
    const t = finThickness(geom);
    finFrontal += f.count * t * f.span;
    meanChord += (f.Cr + f.Ct) / 2;
    nFinSets++;
  }
  return {
    wetBody,
    wetFins,
    finFrontal,
    finThickness: finThickness(geom),
    finChord: nFinSets ? meanChord / nFinSets : 0.05,
    baseArea: Math.PI * baseR * baseR,
    length: Math.min(xBottom, geom.length),
    fineness: Math.min(xBottom, geom.length) / (2 * maxR || 1),
  };
}

function finThickness(geom) {
  return Math.min(0.0048, Math.max(0.0016, 0.1 * geom.refDiameter));
}

/** Mass properties of a uniform shell over the section [xTop, xBottom]. */
export function shellMassProperties(geom, mass, xTop = 0, xBottom = geom.length) {
  let a = 0;
  let ax = 0;
  for (let i = 0; i < geom.nSlices; i++) {
    const x = geom.xs[i];
    if (x < xTop || x > xBottom) continue;
    a += geom.shellArea[i];
    ax += geom.shellArea[i] * x;
  }
  const cg = a > 0 ? ax / a : (xTop + xBottom) / 2;
  let I = 0;
  for (let i = 0; i < geom.nSlices; i++) {
    const x = geom.xs[i];
    if (x < xTop || x > xBottom) continue;
    const r = geom.rb[i];
    I += geom.shellArea[i] * ((x - cg) * (x - cg) + (r * r) / 2);
  }
  return { cg, inertia: a > 0 ? (mass * I) / a : 0, area: a };
}

/** Rough airframe mass estimate (kit construction: paper tubes, balsa/plastic). */
export function estimateAirframeMass(geom, xTop = 0, xBottom = geom.length) {
  let a = 0;
  for (let i = 0; i < geom.nSlices; i++) {
    const x = geom.xs[i];
    if (x >= xTop && x <= xBottom) a += geom.shellArea[i];
  }
  // ~0.75 kg/m² shell areal density matches typical cardboard/balsa/plastic kits,
  // scaled up a little for larger diameters (thicker tubes).
  const density = 0.75 * Math.max(0.8, Math.min(2.2, geom.refDiameter / 0.025));
  return a * density;
}

/** Station (from tail) where the body is widest near the tail = fin can etc. */
export function suggestSeparation(geom) {
  // two or more fin sets → separate just ahead of the lowest fin set
  const sets = [...geom.finSets].sort((a, b) => b.xLE - a.xLE); // aft-most first
  if (sets.length >= 2) {
    const lower = sets[0];
    const upper = sets[1];
    // separation is between the lower fin set's leading edge and upper set's trailing edge
    const xUpperTE = upper.xLE + upper.Cr;
    const xSep = Math.max(xUpperTE + 0.002, Math.min(lower.xLE - 0.005, geom.length - 0.075));
    return geom.length - xSep;
  }
  return null;
}
