// Detailed tripod launch pad modelled on the classic Estes "Porta-Pad" style:
// three snap-in plastic legs with feet, a centre hub, tilt bracket with wing nut,
// steel blast deflector, two-piece 1/8" launch rod with joint sleeve and a bright
// rod safety cap.
import * as THREE from 'three';

const ROD_SPECS = {
  '1/8x36': { dia: 0.003175, len: 0.9144, label: '1/8" × 36" two-piece rod' },
  '3/16x36': { dia: 0.0047625, len: 0.9144, label: '3/16" × 36" rod' },
  '3/16x48': { dia: 0.0047625, len: 1.2192, label: '3/16" × 48" rod' },
  '1/4x72': { dia: 0.00635, len: 1.8288, label: '1/4" × 72" rod' },
};
export { ROD_SPECS };

function beam(a, b, w, h, mat) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, len), mat);
  m.position.copy(a).addScaledVector(dir, 0.5);
  m.lookAt(b);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function sootTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#b9bcc0';
  g.fillRect(0, 0, 256, 256);
  // brushed steel streaks
  for (let i = 0; i < 400; i++) {
    g.strokeStyle = `rgba(${150 + Math.random() * 80},${150 + Math.random() * 80},${155 + Math.random() * 80},0.25)`;
    g.beginPath();
    const y = Math.random() * 256;
    g.moveTo(0, y);
    g.lineTo(256, y + (Math.random() - 0.5) * 6);
    g.stroke();
  }
  // exhaust soot and heat discoloration
  const grad = g.createRadialGradient(128, 128, 4, 128, 128, 120);
  grad.addColorStop(0, 'rgba(20,18,16,0.95)');
  grad.addColorStop(0.25, 'rgba(40,32,26,0.8)');
  grad.addColorStop(0.5, 'rgba(90,70,50,0.45)');
  grad.addColorStop(0.75, 'rgba(120,100,140,0.18)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 60; i++) {
    g.fillStyle = `rgba(10,10,10,${Math.random() * 0.4})`;
    g.beginPath();
    g.arc(128 + (Math.random() - 0.5) * 140, 128 + (Math.random() - 0.5) * 140, Math.random() * 4, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class LaunchPad {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'LaunchPad';
    const legMat = new THREE.MeshStandardMaterial({ color: 0x3b3e43, roughness: 0.6, metalness: 0.05 });
    const hubMat = new THREE.MeshStandardMaterial({ color: 0x1f2124, roughness: 0.5 });
    const metal = new THREE.MeshStandardMaterial({ color: 0xc9ccd0, roughness: 0.3, metalness: 0.9 });
    const rodMat = new THREE.MeshStandardMaterial({ color: 0xd8dadd, roughness: 0.18, metalness: 1.0 });
    const brass = new THREE.MeshStandardMaterial({ color: 0xb08d57, roughness: 0.35, metalness: 0.9 });
    this.materials = { legMat, hubMat, metal, rodMat };

    const hubY = 0.085;
    this.pivotY = 0.118;
    // ---- hub ----
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.045, 0.05, 24), hubMat);
    hub.position.y = hubY;
    hub.castShadow = true;
    this.group.add(hub);
    const hubCap = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.036, 0.012, 24), hubMat);
    hubCap.position.y = hubY + 0.031;
    this.group.add(hubCap);
    // leg sockets molded into the hub
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + Math.PI / 6;
      const sock = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.032, 0.04), hubMat);
      sock.position.set(Math.cos(a) * 0.045, hubY - 0.004, Math.sin(a) * 0.045);
      sock.rotation.y = -a + Math.PI / 2;
      sock.castShadow = true;
      this.group.add(sock);

      // ---- legs: flat plastic beams with a stiffening rib and a foot ----
      const from = new THREE.Vector3(Math.cos(a) * 0.055, hubY - 0.006, Math.sin(a) * 0.055);
      const to = new THREE.Vector3(Math.cos(a) * 0.42, 0.014, Math.sin(a) * 0.42);
      this.group.add(beam(from, to, 0.03, 0.009, legMat));
      const ribFrom = from.clone().add(new THREE.Vector3(0, 0.008, 0));
      const ribTo = to.clone().add(new THREE.Vector3(0, 0.006, 0));
      this.group.add(beam(ribFrom, ribTo, 0.006, 0.012, legMat));
      // molded lettering ridges
      for (let k = 1; k < 6; k++) {
        const p = from.clone().lerp(to, k / 7);
        const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.003, 0.004), legMat);
        ridge.position.copy(p).add(new THREE.Vector3(0, 0.006, 0));
        ridge.lookAt(to.clone().add(new THREE.Vector3(0, 0.006, 0)));
        this.group.add(ridge);
      }
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.028, 0.012, 16), hubMat);
      foot.position.set(to.x, 0.006, to.z);
      foot.castShadow = true;
      this.group.add(foot);
    }

    // ---- tilt bracket: two ears, bolt and wing nut ----
    for (const s of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.04, 0.03), hubMat);
      ear.position.set(s * 0.016, this.pivotY - 0.008, 0);
      ear.castShadow = true;
      this.group.add(ear);
    }
    const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.05, 12), metal);
    bolt.rotation.z = Math.PI / 2;
    bolt.position.set(0, this.pivotY, 0);
    this.group.add(bolt);
    const wingNut = new THREE.Group();
    const nutCore = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.006, 0.008, 12), metal);
    nutCore.rotation.z = Math.PI / 2;
    wingNut.add(nutCore);
    for (const s of [-1, 1]) {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(0.002, 0.012, 0.009), metal);
      wing.position.set(0, s * 0.009, 0);
      wing.rotation.x = s * 0.25;
      wingNut.add(wing);
    }
    wingNut.position.set(0.026, this.pivotY, 0);
    this.group.add(wingNut);

    // ---- tilting assembly (pivot at the bolt) ----
    const tilt = new THREE.Group();
    tilt.position.set(0, this.pivotY, 0);
    this.group.add(tilt);
    this.tilt = tilt;
    const block = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.03, 0.026), hubMat);
    block.position.y = 0.01;
    block.castShadow = true;
    tilt.add(block);
    // rod clamp thumb screw
    const thumb = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.004, 14), hubMat);
    thumb.rotation.x = Math.PI / 2;
    thumb.position.set(0, 0.018, 0.017);
    tilt.add(thumb);

    // ---- blast deflector (steel plate on a riser) ----
    this.deflectorY = 0.036;
    const riser = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.01, 0.012, 16), metal);
    riser.position.y = 0.029;
    tilt.add(riser);
    const plate = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.058, 0.0015, 48),
      new THREE.MeshStandardMaterial({ map: sootTexture(), roughness: 0.45, metalness: 0.85 })
    );
    plate.position.y = this.deflectorY - 0.00075;
    plate.castShadow = true;
    plate.receiveShadow = true;
    tilt.add(plate);
    const lip = new THREE.Mesh(new THREE.TorusGeometry(0.0595, 0.0012, 6, 48), metal);
    lip.rotation.x = Math.PI / 2;
    lip.position.y = this.deflectorY - 0.0006;
    tilt.add(lip);

    // ---- launch rod ----
    this.rodGroup = new THREE.Group();
    tilt.add(this.rodGroup);
    this.rodMat = rodMat;
    this.brass = brass;
    this.setRod('1/8x36');
    this.setTilt(0, 0);
  }

  setRod(key) {
    const spec = ROD_SPECS[key] || ROD_SPECS['1/8x36'];
    this.rodSpec = spec;
    this.rodKey = key;
    this.rodGroup.clear();
    const r = spec.dia / 2;
    const base = 0.0;
    const half = spec.len / 2;
    const twoPiece = key === '1/8x36' || key === '3/16x36';
    const segs = twoPiece ? [[base, base + half], [base + half, base + spec.len]] : [[base, base + spec.len]];
    for (const [a, b] of segs) {
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(r, r, b - a, 10), this.rodMat);
      rod.position.set(this.rodOffsetX(), (a + b) / 2, 0);
      rod.castShadow = true;
      this.rodGroup.add(rod);
    }
    if (twoPiece) {
      const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.9, r * 1.9, 0.03, 12), this.brass);
      sleeve.position.set(this.rodOffsetX(), base + half, 0);
      this.rodGroup.add(sleeve);
    }
    // safety cap (removable)
    const cap = new THREE.Group();
    const capMat = new THREE.MeshStandardMaterial({ color: 0xff5a1f, roughness: 0.45, emissive: 0x401000 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.0085, 0.028, 18), capMat);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.009, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), capMat);
    dome.position.y = 0.014;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.0088, 0.0012, 6, 18), capMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = -0.012;
    cap.add(body, dome, ring);
    cap.traverse((o) => (o.castShadow = true));
    cap.position.set(this.rodOffsetX(), base + spec.len - 0.008, 0);
    this.cap = cap;
    this.capHome = cap.position.clone();
    this.rodGroup.add(cap);
    this.capRemoved = false;
  }

  rodOffsetX() {
    return 0; // the rod sits on the pad axis; the rocket hangs beside it on its lug
  }

  setTilt(angleDeg, azimuthDeg) {
    this.tiltAngle = angleDeg;
    this.tiltAzimuth = azimuthDeg;
    // azimuth: compass heading the rod leans toward (0 = north = −z)
    this.group.rotation.y = -THREE.MathUtils.degToRad(azimuthDeg);
    this.tilt.rotation.set(-THREE.MathUtils.degToRad(angleDeg), 0, 0);
    this.group.updateMatrixWorld(true);
  }

  /** Unit vector along the rod (world). */
  rodDirection() {
    return new THREE.Vector3(0, 1, 0).applyQuaternion(this.tilt.getWorldQuaternion(new THREE.Quaternion())).normalize();
  }

  /**
   * World position of the rocket's tail centre when sitting on the deflector,
   * hung beside the rod by a launch lug.
   */
  rocketTail(bodyRadius, standoff = 0.003) {
    const lugOffset = bodyRadius + 0.0028 + this.rodSpec.dia / 2;
    const p = new THREE.Vector3(lugOffset, this.deflectorY + standoff, 0);
    return this.tilt.localToWorld(p);
  }

  rodTop() {
    return this.tilt.localToWorld(new THREE.Vector3(0, this.rodSpec.len, 0));
  }

  removeCap(animate = true) {
    if (this.capRemoved) return;
    this.capRemoved = true;
    this.capAnim = animate ? 0 : 1;
  }

  restoreCap() {
    this.capRemoved = false;
    this.capAnim = null;
    this.cap.visible = true;
    this.cap.position.copy(this.capHome);
    this.cap.rotation.set(0, 0, 0);
  }

  update(dt) {
    if (this.capAnim !== null && this.capAnim !== undefined && this.capRemoved) {
      this.capAnim = Math.min(1, this.capAnim + dt * 1.2);
      const k = this.capAnim;
      // lift off the rod, swing out and drop beside a leg
      this.cap.position.set(this.capHome.x + k * 0.25, this.capHome.y + Math.sin(k * Math.PI) * 0.1 - k * (this.capHome.y + 0.108), this.capHome.z + k * 0.12);
      this.cap.rotation.z = k * 1.4;
      if (k >= 1) this.capAnim = null;
    }
  }
}
