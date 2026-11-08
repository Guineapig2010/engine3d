// Generates the three example rockets as binary STL files (millimetres, Z-up,
// like most CAD/3D-printing exports) in public/examples/.
// Run: npm run build:examples
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'public/examples');
fs.mkdirSync(outDir, { recursive: true });

class Mesh {
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
  /**
   * Surface of revolution about Z. profile = closed loop of [z, r] points,
   * listed counter-clockwise in the (r, z) half-plane so normals face out.
   */
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
  /** Hollow tube between z0..z1 with inner/outer radius. */
  tube(z0, z1, ri, ro, seg = 64) {
    this.revolve([[z0, ri], [z0, ro], [z1, ro], [z1, ri]].reverse(), seg);
  }
  /**
   * Fin: planform polygon in (z, s) where s is the distance outward from the
   * body surface; extruded to thickness t and rotated to angle theta.
   */
  fin(poly, rBase, t, theta) {
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    const map = ([z, sp], side) => {
      const r = rBase + sp;
      const off = side * t / 2;
      return [r * c - off * s, r * s + off * c, z];
    };
    const n = poly.length;
    const top = poly.map((p) => map(p, 1));
    const bot = poly.map((p) => map(p, -1));
    for (let i = 1; i < n - 1; i++) {
      this.tri(top[0], top[i], top[i + 1]);
      this.tri(bot[0], bot[i + 1], bot[i]);
    }
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      this.quad(bot[i], bot[j], top[j], top[i]);
    }
  }
  /** Small offset tube (launch lug) parallel to the axis. */
  lug(z0, z1, ri, ro, rPos, theta, seg = 16) {
    const cx = rPos * Math.cos(theta);
    const cy = rPos * Math.sin(theta);
    const start = this.tris.length;
    this.tube(z0, z1, ri, ro, seg);
    for (let i = start; i < this.tris.length; i++) {
      this.tris[i] = this.tris[i].map(([x, y, z]) => [x + cx, y + cy, z]);
    }
  }
  /** Translate every triangle added since `start`. */
  translate(start, dx, dy, dz) {
    for (let i = start; i < this.tris.length; i++) this.tris[i] = this.tris[i].map(([x, y, z]) => [x + dx, y + dy, z + dz]);
  }
  toBinarySTL(name) {
    const buf = Buffer.alloc(84 + this.tris.length * 50);
    buf.write(('Rocket Flight Lab example: ' + name).slice(0, 79), 0, 'ascii');
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

function ogive(R, Ln, n = 24) {
  const rho = (R * R + Ln * Ln) / (2 * R);
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const x = (i / n) * Ln; // from tip
    const r = Math.sqrt(Math.max(0, rho * rho - (Ln - x) ** 2)) + R - rho;
    pts.push([x, Math.max(0, r)]);
  }
  return pts;
}

function vonKarman(R, Ln, n = 28) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const x = (i / n) * Ln;
    const th = Math.acos(1 - (2 * x) / Ln);
    pts.push([x, (R / Math.sqrt(Math.PI)) * Math.sqrt(th - Math.sin(2 * th) / 2)]);
  }
  return pts;
}

/** Nose cone with shoulder, base at zBase, tip pointing +Z. */
function noseCone(mesh, shape, zBase, R, Ln, rShoulder, shoulderLen) {
  const prof = shape.map(([x, r]) => [zBase + Ln - x, r]); // tip first (highest z)
  // closed loop CCW in (r,z): go from tip down the outside, then shoulder, then axis
  const loop = [];
  for (let i = prof.length - 1; i >= 0; i--) loop.push(prof[i]); // base → tip? reverse below
  // build in order: axis bottom → shoulder bottom → shoulder top → base rim → ... → tip
  const pts = [[zBase - shoulderLen, 0], [zBase - shoulderLen, rShoulder], [zBase, rShoulder], [zBase, R]];
  for (let i = prof.length - 2; i >= 0; i--) pts.push(prof[i]);
  mesh.revolve(pts.reverse().map((p) => p), 48);
  void loop;
}

function finSet(mesh, count, rBody, zRootTE, Cr, Ct, span, sweep, t, phase = 0) {
  const poly = [
    [zRootTE, -0.6],
    [zRootTE + Cr, -0.6],
    [zRootTE + Cr - sweep, span],
    [zRootTE + Cr - sweep - Ct, span],
  ];
  for (let i = 0; i < count; i++) mesh.fin(poly, rBody, t, phase + (i / count) * Math.PI * 2);
}

// ---------------------------------------------------------------------------
// 1. "Sparrow" — simple single-stage 18 mm C-motor sport rocket, 12" chute.
// ---------------------------------------------------------------------------
function sparrow() {
  const m = new Mesh();
  const R = 12.4; // 24.8 mm OD body
  const Ri = 12.05;
  const bodyLen = 330;
  m.tube(0, bodyLen, Ri, R, 64);
  // 18 mm motor mount (ID 18.0, OD 18.7), 75 mm long, with two centering rings
  m.tube(0, 75, 9.0, 9.35, 48);
  m.tube(8, 11, 9.35, Ri, 48);
  m.tube(62, 65, 9.35, Ri, 48);
  noseCone(m, ogive(R, 85), bodyLen, R, 85, Ri - 0.05, 22);
  finSet(m, 3, R, 0, 70, 30, 55, 40, 2.4, Math.PI / 2);
  m.lug(120, 160, 1.8, 2.5, R + 2.5, Math.PI / 2 + Math.PI / 3);
  return m;
}

// ---------------------------------------------------------------------------
// 2. "Stratos" — minimum-diameter 24 mm high-altitude E-motor rocket.
// ---------------------------------------------------------------------------
function stratos() {
  const m = new Mesh();
  const R = 12.4;
  const Ri = 12.05; // the body tube is the motor tube (24 mm motors)
  const bodyLen = 520;
  m.tube(0, bodyLen, Ri, R, 64);
  noseCone(m, vonKarman(R, 135), bodyLen, R, 135, Ri - 0.05, 30);
  // thin swept fins
  finSet(m, 3, R, 0, 85, 32, 48, 62, 2.4, Math.PI / 2);
  m.lug(200, 240, 1.8, 2.5, R + 2.5, Math.PI / 2 + Math.PI / 3);
  return m;
}

// ---------------------------------------------------------------------------
// 3. "Twin Falcon" — two-stage 18 mm C-motor rocket (C6-0 booster → C6-7).
//    Body is 18.7 mm OD so the motors fit directly (minimum diameter).
// ---------------------------------------------------------------------------
function twinFalcon() {
  const m = new Mesh();
  const R = 9.35;
  const Ri = 9.0;
  // booster: 0..78 mm, four large fins
  m.tube(0, 78, Ri, R, 48);
  finSet(m, 4, R, 0, 66, 34, 50, 26, 2.0, Math.PI / 4);
  // interstage coupler visible gap ring
  m.tube(78, 79, Ri - 0.4, R - 0.25, 48);
  // sustainer: 79..399 mm, three fins flush with its aft end
  m.tube(79, 399, Ri, R, 48);
  finSet(m, 3, R, 79, 56, 26, 40, 26, 2.0, Math.PI / 2);
  noseCone(m, ogive(R, 72), 399, R, 72, Ri - 0.05, 18);
  m.lug(170, 205, 1.8, 2.5, R + 2.5, Math.PI / 2 + Math.PI / 3);
  return m;
}

function cone(R, Ln, n = 2) {
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push([(i / n) * Ln, (i / n) * R]);
  return pts;
}

// ---------------------------------------------------------------------------
// 4. "Triple Threat" — three-stage 18 mm rocket exported as SEPARATE parts laid
//    side by side (the typical 3D-printing layout). The app detects the parts,
//    orders them and stacks them (coupler stubs into the stage above).
// ---------------------------------------------------------------------------
function tripleSeparated() {
  const m = new Mesh();
  const R = 9.35;
  const Ri = 9.0;
  // bottom booster (largest fins) — on the left
  let s0 = m.tris.length;
  m.tube(0, 80, Ri, R, 48);
  m.tube(80, 96, 8.5, Ri - 0.05, 48); // coupler stub that slides into stage 2
  finSet(m, 3, R, 0, 64, 34, 52, 26, 2.0, Math.PI / 2);
  m.translate(s0, -160, 0, 0);
  // middle booster
  s0 = m.tris.length;
  m.tube(0, 78, Ri, R, 48);
  m.tube(78, 94, 8.5, Ri - 0.05, 48);
  finSet(m, 3, R, 0, 58, 30, 46, 24, 2.0, Math.PI / 2);
  m.translate(s0, 0, 0, 0);
  // sustainer with conical nose — on the right
  s0 = m.tris.length;
  m.tube(0, 300, Ri, R, 48);
  finSet(m, 3, R, 0, 52, 26, 40, 22, 2.0, Math.PI / 2);
  noseCone(m, cone(R, 90), 300, R, 90, Ri - 0.05, 16);
  m.lug(120, 155, 1.8, 2.5, R + 2.5, Math.PI / 2 + Math.PI / 3);
  m.translate(s0, 160, 0, 0);
  return m;
}

const models = [
  ['sparrow-c.stl', 'Sparrow C (single stage, 18 mm)', sparrow()],
  ['stratos-e.stl', 'Stratos E (high altitude, 24 mm)', stratos()],
  ['twin-falcon-2stage.stl', 'Twin Falcon (two stage, 18 mm)', twinFalcon()],
  ['triple-threat-3stage-separated.stl', 'Triple Threat (3 stage, separated parts)', tripleSeparated()],
];
for (const [file, name, mesh] of models) {
  fs.writeFileSync(path.join(outDir, file), mesh.toBinarySTL(name));
  console.log(`${file}: ${mesh.tris.length} triangles`);
}
