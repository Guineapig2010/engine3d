// Estes-style "Starter" (electric igniter) and its plastic igniter plug.
// The starter is two thin copper leads with a pyrogen-dipped tip. It goes into
// the motor nozzle until the tip touches the propellant, the plug is pushed in
// to hold it, then the leads are bent apart so the micro-clips can't touch.
import * as THREE from 'three';

const COPPER = new THREE.MeshStandardMaterial({ color: 0xc8753a, metalness: 1, roughness: 0.32 });

export class Starter {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'Starter';
    this.bend = 0; // 0 straight, 1 leads bent apart
    this.tipMat = new THREE.MeshStandardMaterial({ color: 0x2b2420, roughness: 0.9, emissive: 0x000000 });
    this.tip = new THREE.Mesh(new THREE.SphereGeometry(0.0016, 12, 8), this.tipMat);
    this.tip.scale.set(1, 1.6, 1);
    this.tip.position.y = 0.017;
    this.group.add(this.tip);
    // paper tab with the starter's lot label, kept on the leads until you bend them
    this.wires = [];
    this.rebuild();
  }

  /** Lead path (starter-local). +y is into the motor; y = 0 is the nozzle exit. */
  path(side) {
    const b = this.bend;
    const s = side;
    const straight = [
      [s * 0.0005, 0.016],
      [s * 0.0007, 0.006],
      [s * 0.0009, -0.004],
      [s * 0.0012, -0.02],
      [s * 0.0015, -0.036],
      [s * 0.0018, -0.05],
    ];
    const bent = [
      [s * 0.0005, 0.016],
      [s * 0.0007, 0.006],
      [s * 0.0012, -0.0025],
      [s * 0.009, -0.006],
      [s * 0.022, -0.0075],
      [s * 0.034, -0.006],
    ];
    return straight.map(([x, y], i) => new THREE.Vector3(x + (bent[i][0] - x) * b, y + (bent[i][1] - y) * b, 0));
  }

  rebuild() {
    for (const w of this.wires) {
      this.group.remove(w);
      w.geometry.dispose();
    }
    this.wires = [];
    for (const s of [-1, 1]) {
      const curve = new THREE.CatmullRomCurve3(this.path(s));
      const w = new THREE.Mesh(new THREE.TubeGeometry(curve, 28, 0.00042, 5), COPPER);
      w.castShadow = true;
      this.group.add(w);
      this.wires.push(w);
    }
  }

  setBend(b) {
    if (Math.abs(b - this.bend) < 1e-3) return;
    this.bend = b;
    this.rebuild();
  }

  /** World positions of the two lead ends (where micro-clips bite). */
  leadEnds() {
    this.group.updateMatrixWorld(true);
    return [-1, 1].map((s) => {
      const pts = this.path(s);
      const a = pts[pts.length - 2];
      const e = pts[pts.length - 1];
      // bite a few millimetres in from the very end of the wire
      return this.group.localToWorld(new THREE.Vector3().lerpVectors(e, a, 0.35));
    });
  }

  /** Outward direction of each lead end (world), for orienting the clips. */
  leadDirs() {
    this.group.updateMatrixWorld(true);
    const q = this.group.getWorldQuaternion(new THREE.Quaternion());
    return [-1, 1].map((s) => {
      const pts = this.path(s);
      return new THREE.Vector3().subVectors(pts[pts.length - 1], pts[pts.length - 3]).normalize().applyQuaternion(q);
    });
  }

  setHeat(h) {
    this.tipMat.emissive.setRGB(h * 1.6, h * 0.55, h * 0.12);
    this.tipMat.color.setRGB(0.17 + h * 0.6, 0.14 + h * 0.2, 0.12);
  }

  setBurnt() {
    this.tipMat.emissive.setRGB(0, 0, 0);
    this.tipMat.color.setHex(0x111111);
    this.tip.scale.set(0.7, 0.8, 0.7);
  }
}

export class IgniterPlug {
  constructor(color = 0xd8262b) {
    this.group = new THREE.Group();
    this.group.name = 'IgniterPlug';
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.45 });
    // tapered body that wedges into the nozzle throat, with a groove for the leads
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.0033, 0.0042, 0.009, 18), mat);
    body.position.y = 0.0045;
    const flange = new THREE.Mesh(new THREE.CylinderGeometry(0.0058, 0.0058, 0.0016, 20), mat);
    flange.position.y = -0.0008;
    const tab = new THREE.Mesh(new THREE.BoxGeometry(0.0022, 0.006, 0.0075), mat);
    tab.position.y = -0.0045;
    this.group.add(body, flange, tab);
    this.group.traverse((o) => (o.castShadow = true));
  }
}
