// First-person character: walk around the launch site, look anywhere, zoom
// like binoculars. Mouse look uses pointer lock when the browser allows it
// (click the view), otherwise drag with the left mouse button to look.
import * as THREE from 'three';

export class Player {
  constructor(camera, dom) {
    this.camera = camera;
    this.dom = dom;
    this.pos = new THREE.Vector3(2.6, 0, 2.8); // feet
    this.yaw = 0;
    this.pitch = 0;
    this.eye = 1.62;
    this.keys = new Set();
    this.enabled = true; // false while in a close-up
    this.locked = false;
    this.lookDrag = null;
    this.baseFov = 60;
    this.zoom = 1; // 1 = normal, up to 8× binoculars
    this.binoHeld = false;
    this.lastManualLook = -1e9;
    this.bob = 0;
    this.vel = new THREE.Vector3();
    this.colliders = []; // { x, z, r }
    this.tether = null; // { x, z, r } max distance (launch cord)
    this.lookAt(new THREE.Vector3(0, 0.6, 0));

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === dom;
    });
    document.addEventListener('pointerlockerror', () => {
      this.lockFailed = true;
    });
    window.addEventListener('keydown', (e) => {
      if (isTyping(e)) return;
      this.keys.add(e.code);
      if (e.code === 'KeyZ') this.binoHeld = true;
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'KeyZ') this.binoHeld = false;
    });
    window.addEventListener('blur', () => this.keys.clear());
    dom.addEventListener('mousemove', (e) => {
      if (!this.enabled) return;
      if (this.locked) this.turn(e.movementX, e.movementY);
      else if (this.lookDrag) {
        this.turn(e.clientX - this.lookDrag[0], e.clientY - this.lookDrag[1]);
        this.lookDrag = [e.clientX, e.clientY];
      }
    });
    dom.addEventListener('wheel', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      this.zoom = THREE.MathUtils.clamp(this.zoom * (e.deltaY > 0 ? 0.85 : 1.18), 1, 20);
    }, { passive: false });
  }

  /** Start drag-look (fallback when pointer lock isn't available). */
  beginDragLook(e) {
    this.lookDrag = [e.clientX, e.clientY];
  }

  endDragLook() {
    this.lookDrag = null;
  }

  requestLock() {
    if (this.lockFailed || this.locked || !this.dom.requestPointerLock) return;
    try {
      const r = this.dom.requestPointerLock();
      if (r && r.catch) r.catch(() => (this.lockFailed = true));
    } catch {
      this.lockFailed = true;
    }
  }

  releaseLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  turn(dx, dy) {
    if (Math.abs(dx) + Math.abs(dy) > 2) this.lastManualLook = performance.now();
    const s = 0.0022 / Math.sqrt(this.currentZoom());
    this.yaw -= dx * s;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * s, -1.45, 1.52);
  }

  currentZoom() {
    return this.binoHeld ? Math.max(this.zoom, 7) : this.zoom;
  }

  lookAt(target) {
    const eye = this.pos.clone().add(new THREE.Vector3(0, this.eye, 0));
    const d = new THREE.Vector3().subVectors(target, eye);
    this.yaw = Math.atan2(-d.x, -d.z);
    this.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
  }

  /** Smoothly turn toward a world point (track assist). */
  steerToward(target, dt, rate = 4) {
    const eye = this.eyePos();
    const d = new THREE.Vector3().subVectors(target, eye);
    const yaw = Math.atan2(-d.x, -d.z);
    const pitch = THREE.MathUtils.clamp(Math.atan2(d.y, Math.hypot(d.x, d.z)), -1.45, 1.52);
    let dy = yaw - this.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    const k = 1 - Math.exp(-dt * rate);
    this.yaw += dy * k;
    this.pitch += (pitch - this.pitch) * k;
  }

  eyePos() {
    return this.pos.clone().add(new THREE.Vector3(0, this.eye + Math.sin(this.bob) * 0.015, 0));
  }

  forward() {
    return new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
  }

  update(dt) {
    if (this.enabled) {
      const k = this.keys;
      const f = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
      const r = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
      const run = k.has('ShiftLeft') || k.has('ShiftRight');
      const speed = run ? 8.5 : 2.6;
      const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
      const want = fwd.multiplyScalar(f).add(right.multiplyScalar(r));
      if (want.lengthSq() > 0) want.normalize().multiplyScalar(speed);
      this.vel.lerp(want, 1 - Math.exp(-dt * 10));
      this.pos.addScaledVector(this.vel, dt);
      if (this.vel.length() > 0.3) this.bob += dt * (run ? 13 : 8.5);
      // keep out of the pad legs, the table, etc.
      for (const c of this.colliders) {
        const dx = this.pos.x - c.x;
        const dz = this.pos.z - c.z;
        const d = Math.hypot(dx, dz);
        if (d < c.r && d > 1e-6) {
          this.pos.x = c.x + (dx / d) * c.r;
          this.pos.z = c.z + (dz / d) * c.r;
        }
      }
      if (this.tether) {
        const dx = this.pos.x - this.tether.x;
        const dz = this.pos.z - this.tether.z;
        const d = Math.hypot(dx, dz);
        if (d > this.tether.r) {
          this.pos.x = this.tether.x + (dx / d) * this.tether.r;
          this.pos.z = this.tether.z + (dz / d) * this.tether.r;
          this.cordTaut = true;
        } else this.cordTaut = false;
      } else this.cordTaut = false;
      this.pos.y = 0;
    }
    const cam = this.camera;
    cam.position.copy(this.eyePos());
    cam.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
    const fov = this.baseFov / this.currentZoom();
    cam.fov += (fov - cam.fov) * (1 - Math.exp(-dt * 12));
    cam.updateProjectionMatrix();
  }
}

export function isTyping(e) {
  const t = e.target;
  return t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA');
}
