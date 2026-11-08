// Hand-held launch controller modelled on the current Estes "Electron Beam":
// red moulded handset, 4×AA, LED continuity light, spring-loaded safety key that
// only closes the circuit while it is PUSHED DOWN and HELD, a big push-button and
// a 17 ft (5.2 m) lead ending in two micro-clips.
//
// Real procedure (Estes): hook up with the key in your pocket → walk back the
// length of the cord → insert the key and push it down hard: the LED lights →
// while holding the key down firmly, press and hold LAUNCH until liftoff (the
// LED goes out while current flows to the igniter) → remove the key.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

export const CORD_LENGTH = 5.2; // m (17 ft)

function labelTexture() {
  const c = document.createElement('canvas');
  c.width = 400;
  c.height = 1000;
  const g = c.getContext('2d');
  g.fillStyle = '#121214';
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = '#d8d8d8';
  g.lineWidth = 4;
  g.strokeRect(14, 14, c.width - 28, c.height - 28);
  g.textAlign = 'center';
  g.fillStyle = '#f2f2f2';
  g.font = 'bold 30px Arial, sans-serif';
  g.fillText('SAFETY KEY', 200, 70);
  g.font = '20px Arial, sans-serif';
  g.fillStyle = '#bdbdbd';
  g.fillText('INSERT · PUSH DOWN · HOLD', 200, 300);
  g.fillStyle = '#f2f2f2';
  g.font = 'bold 26px Arial, sans-serif';
  g.fillText('CONTINUITY', 200, 352);
  g.font = 'bold 40px Arial, sans-serif';
  g.fillStyle = '#ffffff';
  g.fillText('LAUNCH', 200, 520);
  g.font = 'bold 22px Arial, sans-serif';
  g.fillStyle = '#ffcc33';
  g.fillText('⚠ REMOVE KEY', 200, 900);
  g.fillText('WHEN NOT LAUNCHING', 200, 930);
  g.fillStyle = '#9a9a9a';
  g.font = '18px Arial, sans-serif';
  g.fillText('6 V · 4 × AA', 200, 965);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export class LaunchController {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'LaunchController';
    const W = 0.062;
    const T = 0.034;
    const Lh = 0.165;
    this.size = { W, T, L: Lh };
    const red = new THREE.MeshStandardMaterial({ color: 0xc8191e, roughness: 0.42, metalness: 0.02 });
    const darkRed = new THREE.MeshStandardMaterial({ color: 0x8e0f13, roughness: 0.6 });
    const black = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.55 });
    const chrome = new THREE.MeshStandardMaterial({ color: 0xe2e4e6, roughness: 0.18, metalness: 1 });

    // moulded two-piece shell with a parting line and a slimmer grip end
    const top = new THREE.Mesh(new RoundedBoxGeometry(W, T * 0.55, Lh, 5, 0.012), red);
    top.position.y = T * 0.22;
    const bottom = new THREE.Mesh(new RoundedBoxGeometry(W * 0.98, T * 0.5, Lh * 0.99, 5, 0.012), red);
    bottom.position.y = -T * 0.22;
    const seam = new THREE.Mesh(new THREE.BoxGeometry(W * 1.002, 0.0012, Lh * 0.96), darkRed);
    for (const m of [top, bottom]) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
    this.group.add(top, bottom, seam);
    this.body = top;
    // finger grooves on the underside
    for (let i = 0; i < 4; i++) {
      const groove = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, W * 0.9, 12), darkRed);
      groove.rotation.z = Math.PI / 2;
      groove.position.set(0, -T * 0.47, -0.03 + i * 0.019);
      this.group.add(groove);
    }
    // label panel (top face). Texture top faces +z (the cord / pad end).
    const label = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.8, Lh * 0.82), new THREE.MeshStandardMaterial({ map: labelTexture(), roughness: 0.5 }));
    label.rotation.set(-Math.PI / 2, 0, Math.PI);
    label.position.y = T * 0.5 + 0.0004;
    this.group.add(label);
    const zAt = (py) => Lh * 0.41 - (py / 1000) * Lh * 0.82;
    const topY = T * 0.5;

    // battery door + screws underneath
    const door = new THREE.Mesh(new THREE.BoxGeometry(W * 0.7, 0.001, Lh * 0.42), darkRed);
    door.position.set(0, -T * 0.49, -0.035);
    this.group.add(door);
    for (const [x, z] of [[-0.022, -0.07], [0.022, -0.07], [-0.022, 0.07], [0.022, 0.07]]) {
      const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.002, 0.001, 10), chrome);
      screw.position.set(x, -T * 0.5, z);
      this.group.add(screw);
    }

    // ---- safety-key slot (chrome escutcheon with a narrow slot) ----
    const slotZ = zAt(170);
    const esc = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.0095, 0.003, 28), chrome);
    esc.position.set(0, topY + 0.0015, slotZ);
    this.group.add(esc);
    const slot = new THREE.Mesh(new THREE.BoxGeometry(0.0058, 0.002, 0.0022), new THREE.MeshBasicMaterial({ color: 0x000000 }));
    slot.position.set(0, topY + 0.0031, slotZ);
    this.group.add(slot);
    this.slotLocal = new THREE.Vector3(0, topY + 0.003, slotZ);

    // ---- safety key: flat steel key with a black grip and a ring ----
    const key = new THREE.Group();
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.0055, 0.024, 0.0018), chrome);
    blade.position.y = -0.006;
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.0035, 0.004, 0.0018), chrome);
    tip.position.y = -0.0195;
    const grip = new THREE.Mesh(new RoundedBoxGeometry(0.019, 0.016, 0.006, 3, 0.0028), black);
    grip.position.y = 0.0125;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.0075, 0.0009, 6, 24), chrome);
    ring.position.y = 0.026;
    key.add(blade, tip, grip, ring);
    key.traverse((o) => (o.castShadow = true));
    this.key = key;
    this.keyGrip = grip;
    this.group.add(key);
    // positions: in the slot (resting, not making contact) and pushed down (contact)
    this.keyUp = new THREE.Vector3(0, topY + 0.0215, slotZ);
    this.keyDownPos = new THREE.Vector3(0, topY + 0.0155, slotZ);
    this.keyHand = new THREE.Vector3(W / 2 + 0.05, 0.01, slotZ + 0.01); // held in your other hand
    this.keyState = 'out'; // 'out' | 'in'
    this.keyPushed = false;
    this.keyPress = 0;

    // ---- continuity LED in a chrome bezel ----
    const ledZ = zAt(390);
    const bezel = new THREE.Mesh(new THREE.CylinderGeometry(0.0055, 0.006, 0.003, 20), chrome);
    bezel.position.set(0, topY + 0.0015, ledZ);
    this.group.add(bezel);
    this.ledMat = new THREE.MeshStandardMaterial({ color: 0x5a0b0b, roughness: 0.15, emissive: 0xff1a10, emissiveIntensity: 0, transparent: true, opacity: 0.92 });
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.0034, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), this.ledMat);
    led.position.set(0, topY + 0.003, ledZ);
    this.group.add(led);
    this.ledLight = new THREE.PointLight(0xff2010, 0, 0.3, 2);
    this.ledLight.position.set(0, topY + 0.012, ledZ);
    this.group.add(this.ledLight);

    // ---- launch push-button: large dark button in a raised collar ----
    const btnZ = zAt(660);
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.0175, 0.019, 0.006, 32), black);
    collar.position.set(0, topY + 0.003, btnZ);
    this.group.add(collar);
    const btnMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2c, roughness: 0.35 });
    const button = new THREE.Mesh(new THREE.CylinderGeometry(0.0138, 0.0142, 0.009, 32), btnMat);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.0138, 28, 8, 0, Math.PI * 2, 0, Math.PI * 0.16), btnMat);
    cap.position.y = -0.0085;
    cap.scale.y = 1.6;
    button.add(cap);
    button.position.set(0, topY + 0.0075, btnZ);
    button.castShadow = true;
    this.button = button;
    this.buttonUpY = button.position.y;
    this.group.add(button);

    // ---- cord strain relief at the +z end ----
    const relief = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0065, 0.024, 12), black);
    relief.rotation.x = Math.PI / 2;
    relief.position.set(0, -0.002, Lh / 2 + 0.01);
    this.group.add(relief);
    this.cordExitLocal = new THREE.Vector3(0, -0.002, Lh / 2 + 0.022);

    this.ledOn = false;
    this.pressed = false;
    this.held = false;
    this.applyKey();
  }

  cordExitWorld() {
    this.group.updateMatrixWorld(true);
    return this.group.localToWorld(this.cordExitLocal.clone());
  }

  slotWorld() {
    this.group.updateMatrixWorld(true);
    return this.group.localToWorld(this.slotLocal.clone());
  }

  setKeyState(s) {
    this.keyState = s;
    if (s === 'out') this.keyPushed = false;
    this.applyKey();
  }

  setKeyPushed(p) {
    this.keyPushed = this.keyState === 'in' && p;
  }

  applyKey() {
    if (this.dragging) return;
    if (this.keyState === 'in') {
      this.key.position.lerpVectors(this.keyUp, this.keyDownPos, this.keyPress);
      this.key.rotation.set(0, 0, 0);
    } else {
      this.key.position.copy(this.keyHand);
      this.key.rotation.set(0.2, 0.6, -0.5);
    }
    this.key.visible = this.keyState === 'in' || this.held;
  }

  setLed(on) {
    this.ledOn = on;
  }

  setPressed(p) {
    this.pressed = p;
  }

  update(dt, time) {
    const target = this.keyPushed ? 1 : 0;
    this.keyPress += (target - this.keyPress) * Math.min(1, dt * 25);
    this.applyKey();
    const glow = this.ledOn ? 0.9 + 0.1 * Math.sin(time * 40) : 0;
    this.ledMat.emissiveIntensity = 6 * glow;
    this.ledMat.color.setHex(this.ledOn ? 0xff3a2a : 0x5a0b0b);
    this.ledLight.intensity = 0.06 * glow;
    const bt = this.pressed ? this.buttonUpY - 0.004 : this.buttonUpY;
    this.button.position.y += (bt - this.button.position.y) * Math.min(1, dt * 30);
  }
}

// ---------------------------------------------------------------------------
// Micro-clip (small alligator clip) and the 2-conductor launch lead.
// ---------------------------------------------------------------------------
function microClip(color) {
  const g = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0xcfd2d6, metalness: 1, roughness: 0.28 });
  // jaws point along −z (toward what they bite)
  for (const s of [-1, 1]) {
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.0042, 0.0012, 0.022), steel);
    jaw.position.set(0, s * 0.0016, -0.006);
    jaw.rotation.x = -s * 0.07;
    g.add(jaw);
    for (let i = 0; i < 5; i++) {
      const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.0042, 0.0007, 0.0008), steel);
      tooth.position.set(0, s * 0.0008, -0.015 + i * 0.0018);
      g.add(tooth);
    }
    const lever = new THREE.Mesh(new THREE.BoxGeometry(0.0044, 0.0011, 0.01), steel);
    lever.position.set(0, s * 0.0034, 0.009);
    lever.rotation.x = s * 0.35;
    g.add(lever);
  }
  const spring = new THREE.Mesh(new THREE.TorusGeometry(0.0021, 0.0006, 6, 12), steel);
  spring.rotation.y = Math.PI / 2;
  spring.position.z = 0.004;
  g.add(spring);
  const crimp = new THREE.Mesh(new THREE.CylinderGeometry(0.0016, 0.0018, 0.006, 8), new THREE.MeshStandardMaterial({ color, roughness: 0.55 }));
  crimp.rotation.x = Math.PI / 2;
  crimp.position.z = 0.016;
  g.add(crimp);
  g.traverse((o) => (o.castShadow = true));
  g.userData.wireLocal = new THREE.Vector3(0, 0, 0.019);
  return g;
}

export class LaunchLead {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.clips = [microClip(0xb01818), microClip(0x1a1a1a)];
    for (const c of this.clips) this.group.add(c);
    this.cableMat = new THREE.MeshStandardMaterial({ color: 0x7a1717, roughness: 0.7 });
    this.leadMats = [new THREE.MeshStandardMaterial({ color: 0xb01818, roughness: 0.6 }), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6 })];
    this.meshes = [];
    this.dirty = true;
  }

  /** start: controller cord exit (world); junction: where the twin lead splits near the pad. */
  setEnds(start, junction) {
    this.start = start.clone();
    this.junction = junction.clone();
    this.dirty = true;
  }

  /** Pose a clip: p = jaw tip position, dir = direction the jaws point. */
  setClip(i, p, dir) {
    const c = this.clips[i];
    const prev = c.userData.tip;
    if (prev && prev.distanceToSquared(p) < 1e-8 && c.userData.dir && c.userData.dir.distanceToSquared(dir) < 1e-6) return;
    c.userData.dir = dir.clone();
    c.position.copy(p).addScaledVector(dir, -0.017);
    c.lookAt(p.clone().addScaledVector(dir, 1));
    c.rotateY(Math.PI); // jaws (−z) toward p
    c.userData.tip = p.clone();
    this.dirty = true;
  }

  rebuild() {
    for (const m of this.meshes) {
      this.group.remove(m);
      m.geometry.dispose();
    }
    this.meshes = [];
    const s = this.start;
    const j = this.junction;
    if (!s || !j) return;
    // twin lead lying on the grass in lazy curves (slack between controller and pad)
    const pts = [s.clone()];
    const d = s.distanceTo(j);
    const slack = Math.max(0, 5.2 - d);
    const n = 9;
    const side = new THREE.Vector3().subVectors(j, s).setY(0).normalize();
    const perp = new THREE.Vector3(-side.z, 0, side.x);
    for (let i = 1; i < n; i++) {
      const f = i / n;
      const p = new THREE.Vector3().lerpVectors(s, j, f);
      const onGround = s.y < 0.3 || f > 0.15;
      p.y = onGround ? 0.004 : s.y * (1 - f / 0.15);
      p.addScaledVector(perp, Math.sin(f * Math.PI * 3) * (0.08 + slack * 0.12) * (1 - f * 0.6));
      pts.push(p);
    }
    pts.push(j.clone());
    const main = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 90, 0.0022, 6), this.cableMat);
    main.castShadow = true;
    this.group.add(main);
    this.meshes.push(main);
    for (let i = 0; i < 2; i++) {
      const clip = this.clips[i];
      clip.updateMatrixWorld(true);
      const end = clip.localToWorld(clip.userData.wireLocal.clone());
      const mid = new THREE.Vector3().lerpVectors(j, end, 0.5);
      mid.y = Math.max(0.006, Math.min(j.y, end.y) - 0.04);
      const curve = new THREE.CatmullRomCurve3([j.clone(), mid, end]);
      const lead = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.0011, 5), this.leadMats[i]);
      lead.castShadow = true;
      this.group.add(lead);
      this.meshes.push(lead);
    }
    this.dirty = false;
  }

  update() {
    if (this.dirty) this.rebuild();
  }
}
