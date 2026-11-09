// Rocket design specs (millimetres) and a generic mesh builder used by
// gen-examples.mjs. Every design becomes a real binary STL that goes through the
// same analysis pipeline as a user's file.
//
// Standard Estes-type body tubes: [OD, ID]
export const BT = {
  BT5: [13.8, 13.2],
  BT20: [18.7, 18.0],
  BT50: [24.8, 24.1],
  BT55: [33.7, 32.6],
  BT60: [41.6, 40.5],
  BT70: [56.3, 55.4],
  BT80: [66.0, 65.0],
  T3IN: [76.2, 74.0],
};
// motor-mount tubes for each motor diameter: [OD, ID]
export const MMT = { 13: [13.8, 13.2], 18: [18.7, 18.0], 24: [24.8, 24.1], 29: [30.6, 29.2] };

// ---------------------------------------------------------------------------
// Mesh primitives
// ---------------------------------------------------------------------------
export class Mesh {
  constructor() {
    this.tris = [];
  }
  tri(a, b, c) {
    this.tris.push([a, b, c]);
  }
  quad(a, b, c, d) {
    this.tri(a, b, c);
    this.tri(a, c, d);
  }
  revolve(profile, seg = 64) {
    for (let i = 0; i < profile.length; i++) {
      const [z0, r0] = profile[i];
      const [z1, r1] = profile[(i + 1) % profile.length];
      if ((z0 === z1 && r0 === r1) || (r0 < 1e-9 && r1 < 1e-9)) continue;
      for (let j = 0; j < seg; j++) {
        const a0 = (j / seg) * Math.PI * 2;
        const a1 = ((j + 1) / seg) * Math.PI * 2;
        const p = (r, z, a) => [r * Math.cos(a), r * Math.sin(a), z];
        const A = p(r0, z0, a0);
        const B = p(r0, z0, a1);
        const C = p(r1, z1, a1);
        const D = p(r1, z1, a0);
        if (r0 < 1e-9) this.tri(A, C, D);
        else if (r1 < 1e-9) this.tri(A, B, C);
        else this.quad(A, B, C, D);
      }
    }
  }
  /** Hollow tube / frustum shell from z0 (radius ro0) to z1 (radius ro1), wall t. */
  shell(z0, z1, ro0, ro1, t, seg = 64) {
    this.revolve([[z0, ro0 - t], [z0, ro0], [z1, ro1], [z1, ro1 - t]].reverse(), seg);
  }
  tube(z0, z1, ri, ro, seg = 64) {
    this.revolve([[z0, ri], [z0, ro], [z1, ro], [z1, ri]].reverse(), seg);
  }
  /** Extruded fin: poly = [[z, s], ...] with s measured outward from rBase. */
  fin(poly, rBase, t, theta, cx = 0, cy = 0) {
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    const map = ([z, sp], side) => {
      const r = rBase + sp;
      const off = (side * t) / 2;
      return [cx + r * c - off * s, cy + r * s + off * c, z];
    };
    const n = poly.length;
    const top = poly.map((p) => map(p, 1));
    const bot = poly.map((p) => map(p, -1));
    // fan triangulation from the centroid handles the mildly concave fin shapes used here
    const cz = poly.reduce((a, p) => a + p[0], 0) / n;
    const cs = poly.reduce((a, p) => a + p[1], 0) / n;
    const ct = map([cz, cs], 1);
    const cb = map([cz, cs], -1);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      this.tri(ct, top[i], top[j]);
      this.tri(cb, bot[j], bot[i]);
      this.quad(bot[i], bot[j], top[j], top[i]);
    }
  }
  /** Offset tube along the body (launch lug, pod). */
  lug(z0, z1, ri, ro, rPos, theta, seg = 16) {
    const start = this.tris.length;
    this.tube(z0, z1, ri, ro, seg);
    this.translate(start, rPos * Math.cos(theta), rPos * Math.sin(theta), 0);
  }
  translate(start, dx, dy, dz) {
    for (let i = start; i < this.tris.length; i++) this.tris[i] = this.tris[i].map(([x, y, z]) => [x + dx, y + dy, z + dz]);
  }
  toBinarySTL(name) {
    const buf = Buffer.alloc(84 + this.tris.length * 50);
    buf.write(('Rocket Flight Lab: ' + name).slice(0, 79), 0, 'ascii');
    buf.writeUInt32LE(this.tris.length, 80);
    let o = 84;
    for (const [a, b, c] of this.tris) {
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const l = Math.hypot(...n) || 1;
      n = n.map((x) => x / l);
      for (const x of [...n, ...a, ...b, ...c]) {
        buf.writeFloatLE(x, o);
        o += 4;
      }
      buf.writeUInt16LE(0, o);
      o += 2;
    }
    return buf;
  }
}

// ---------------------------------------------------------------------------
// Nose shapes: list of [x from tip, r]
// ---------------------------------------------------------------------------
export function noseProfile(shape, R, Ln, n = 28) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const x = (i / n) * Ln;
    const u = x / Ln;
    let r;
    switch (shape) {
      case 'cone':
        r = u * R;
        break;
      case 'vonkarman': {
        const th = Math.acos(1 - 2 * u);
        r = (R / Math.sqrt(Math.PI)) * Math.sqrt(th - Math.sin(2 * th) / 2);
        break;
      }
      case 'elliptic':
        r = R * Math.sqrt(1 - (1 - u) * (1 - u));
        break;
      case 'parabolic':
        r = R * (2 * u - u * u);
        break;
      case 'blunt': // blunted cone (Patriot-style radome)
        r = Math.min(R, R * (0.18 + 0.82 * u) * Math.min(1, Math.sqrt(u * 12)));
        break;
      case 'ogive':
      default: {
        const rho = (R * R + Ln * Ln) / (2 * R);
        r = Math.sqrt(Math.max(0, rho * rho - (Ln - x) ** 2)) + R - rho;
      }
    }
    pts.push([x, Math.max(0, r)]);
  }
  return pts;
}

function addNose(m, nose, zBase, R, Ri) {
  const prof = noseProfile(nose.shape, R, nose.len).map(([x, r]) => [zBase + nose.len - x, r]);
  const sh = nose.shoulder ?? Math.min(30, R * 1.4);
  const pts = [[zBase - sh, 0], [zBase - sh, Ri - 0.05], [zBase, Ri - 0.05], [zBase, R]];
  for (let i = prof.length - 2; i >= 0; i--) pts.push(prof[i]);
  m.revolve(pts.reverse(), 48);
}

// fin planform → polygon [z, span], z measured from the fin root trailing edge
export function finPoly(f) {
  if (f.poly) return f.poly;
  const { root: Cr, tip: Ct = 0, span: s, sweep = 0 } = f;
  if (f.shape === 'elliptic') {
    const pts = [];
    for (let i = 0; i <= 16; i++) {
      const a = (i / 16) * Math.PI;
      pts.push([Cr / 2 + (Cr / 2) * Math.cos(a), Math.max(0, s * Math.sin(a))]);
    }
    return [[0, -0.6], [Cr, -0.6], ...pts.slice(1, -1)];
  }
  return [[0, -0.6], [Cr, -0.6], [Cr - sweep, s], [Cr - sweep - Ct, s]];
}

/**
 * Build one stage at local z = 0 (its bottom). Returns { mesh, length, topR }.
 * stage = { body: [ {len, bt} | {len, od, id} | {transition: true, len, od0, od1} ],
 *           fins: [{count, root, tip, span, sweep, t, z, phase, shape, poly}],
 *           mounts: [{motor, len, x, y}], stub: {len} , lug: {z, len} }
 */
export function buildStage(m, stage, z0 = 0, isTop = false, nose = null) {
  let z = z0;
  let firstR = null;
  let lastR = null;
  let lastRi = null;
  for (const sec of stage.body) {
    if (sec.transition) {
      const r0 = sec.od0 / 2;
      const r1 = sec.od1 / 2;
      m.shell(z, z + sec.len, r0, r1, 1.0, 64);
      if (firstR === null) firstR = r0;
      lastR = r1;
      lastRi = r1 - 0.7;
    } else {
      const [od, id] = sec.bt ? BT[sec.bt] : [sec.od, sec.id ?? sec.od - 0.8];
      m.tube(z, z + sec.len, id / 2, od / 2, 64);
      if (firstR === null) firstR = od / 2;
      lastR = od / 2;
      lastRi = id / 2;
    }
    z += sec.len;
  }
  const bottomR = firstR;
  const b0 = stage.body[0];
  const bottomRi = b0.transition ? b0.od0 / 2 - 1.0 : (b0.bt ? BT[b0.bt][1] : b0.id ?? b0.od - 0.8) / 2;
  // motor mount tubes with two centering rings each (open at the aft end)
  for (const mt of stage.mounts || []) {
    const [od, id] = MMT[mt.motor];
    const x = mt.x || 0;
    const y = mt.y || 0;
    if (od / 2 >= bottomRi - 0.2) continue; // minimum diameter: the body tube is the motor tube
    const mz = z0 + (mt.z || 0);
    const start = m.tris.length;
    m.tube(mz, mz + mt.len, id / 2, od / 2, 40);
    m.translate(start, x, y, 0);
    if (!x && !y) {
      for (const rz of [mz + 8, mz + mt.len - 6]) m.tube(rz, rz + 2.5, od / 2, bottomRi, 40);
    }
  }
  if ((stage.mounts || []).some((mt) => mt.x || mt.y)) {
    // cluster: solid-ish centering plates are shown as rings around the cluster
    for (const rz of [z0 + 8, z0 + Math.max(...stage.mounts.map((mt) => mt.len)) - 6]) {
      const outer = Math.max(...stage.mounts.map((mt) => Math.hypot(mt.x || 0, mt.y || 0) + MMT[mt.motor][0] / 2));
      m.tube(rz, rz + 2.5, outer, bottomRi, 48);
    }
  }
  for (const f of stage.fins || []) {
    const poly = finPoly(f);
    const rAt = f.r ?? bottomR;
    for (let i = 0; i < f.count; i++) m.fin(poly.map(([pz, s]) => [z0 + (f.z || 0) + pz, s]), rAt, f.t ?? 2.4, (f.phase ?? Math.PI / 2) + (i / f.count) * Math.PI * 2);
  }
  if (stage.lug) {
    const r = stage.lug.r ?? lastR;
    m.lug(z0 + stage.lug.z, z0 + stage.lug.z + stage.lug.len, 1.8, 2.5, r + 2.5, (stage.lug.theta ?? Math.PI / 2 + Math.PI / 3));
  }
  if (stage.pods) {
    for (const pd of stage.pods) {
      for (let i = 0; i < pd.count; i++) {
        const th = (pd.phase ?? 0) + (i / pd.count) * Math.PI * 2;
        const start = m.tris.length;
        const R = pd.od / 2;
        const prof = [[pd.z, 0], [pd.z, R * 0.6], [pd.z + 4, R], [pd.z + pd.len - pd.noseLen, R]];
        for (const [x, r] of noseProfile('ogive', R, pd.noseLen).reverse()) prof.push([pd.z + pd.len - x, r]);
        m.revolve(prof.reverse(), 24);
        m.translate(start, (pd.r + R) * Math.cos(th), (pd.r + R) * Math.sin(th), z0);
      }
    }
  }
  if (stage.stub) {
    const ri = lastRi;
    m.tube(z, z + stage.stub.len, ri - 0.6, ri - 0.05, 48);
  }
  if (isTop && nose) addNose(m, nose, z, lastR, lastRi);
  return { length: z - z0, bottomR };
}

/** Build a whole design: assembled (stacked) or separated (side by side parts). */
export function buildDesign(d) {
  const m = new Mesh();
  const stations = [];
  if (d.layout === 'separated') {
    let x = 0;
    d.stages.forEach((st, k) => {
      const start = m.tris.length;
      const isTop = k === d.stages.length - 1;
      buildStage(m, st, 0, isTop, d.nose);
      const maxR = Math.max(...st.body.map((b) => (b.bt ? BT[b.bt][0] : b.od ?? Math.max(b.od0, b.od1)) / 2)) + Math.max(0, ...(st.fins || []).map((f) => f.span));
      x += k === 0 ? 0 : maxR + 25;
      m.translate(start, x, 0, 0);
      x += maxR;
    });
  } else {
    let z = 0;
    d.stages.forEach((st, k) => {
      const isTop = k === d.stages.length - 1;
      const r = buildStage(m, st, z, isTop, d.nose);
      z += r.length;
      if (!isTop) stations.push(z);
    });
  }
  return { mesh: m, stations };
}
