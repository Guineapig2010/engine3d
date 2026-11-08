// Close-up "hands" mode: the cursor is free and you drag real parts with the
// mouse (starter into the nozzle, plug in, micro-clips onto the leads, the
// safety key into the controller). Parts snap when you drop them close enough
// to their target on screen.
import * as THREE from 'three';

const SNAP_PX = 60;

export class CloseUp {
  constructor(app) {
    this.app = app;
    this.active = null;
    this.ray = new THREE.Raycaster();
    this.drag = null;
    this.press = null;
    const dom = app.world.renderer.domElement;
    this.dom = dom;
    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(0.004, 0.0065, 28),
      new THREE.MeshBasicMaterial({ color: 0x55ff99, transparent: true, opacity: 0.9, depthTest: false, side: THREE.DoubleSide })
    );
    this.marker.renderOrder = 20;
    this.marker.visible = false;
    app.scene.add(this.marker);
    // mouse events (not pointer events): browsers send no second pointerdown while
    // another button is held, and you hold the key (right) while pressing LAUNCH (left)
    dom.addEventListener('mousedown', (e) => this.down(e));
    window.addEventListener('mousemove', (e) => this.move(e));
    window.addEventListener('mouseup', (e) => this.up(e));
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /**
   * spec: {
   *   id, cam(): { pos, look, fov } | null (null = keep the player's camera),
   *   draggables: [{ obj, enabled(), tip(), onMove(worldPoint), targets(): [{ pos, ok(), onSnap(), why }], onRelease() }],
   *   pressables: [{ obj, enabled(), onDown(), onUp() }],
   *   onRight(down), hint(), onExit()
   * }
   */
  enter(spec) {
    if (this.active) this.exit();
    this.active = spec;
    const cam = this.app.world.camera;
    this.tween = { k: 0, fromPos: cam.position.clone(), fromQ: cam.quaternion.clone(), fromFov: cam.fov };
    this.app.player.enabled = false;
    this.app.player.releaseLock();
    this.app.hud.closeup(true);
  }

  exit() {
    const s = this.active;
    if (!s) return;
    this.active = null;
    this.drag = null;
    if (this.press) this.press.onUp?.();
    this.press = null;
    this.marker.visible = false;
    this.app.player.enabled = true;
    this.app.hud.closeup(false);
    s.onExit?.();
  }

  ndc(e) {
    const r = this.dom.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  screen(p) {
    const r = this.dom.getBoundingClientRect();
    const v = p.clone().project(this.app.world.camera);
    return new THREE.Vector2(((v.x + 1) / 2) * r.width, ((1 - v.y) / 2) * r.height);
  }

  hits(e, list) {
    this.ray.setFromCamera(this.ndc(e), this.app.world.camera);
    const objs = list.filter((d) => d.obj.visible && (!d.enabled || d.enabled())).map((d) => d.obj);
    const h = this.ray.intersectObjects(objs, true)[0];
    if (!h) return null;
    return list.find((d) => {
      let o = h.object;
      while (o) {
        if (o === d.obj) return true;
        o = o.parent;
      }
      return false;
    });
  }

  down(e) {
    const s = this.active;
    if (!s) return;
    if (e.button === 2) {
      s.onRight?.(true);
      return;
    }
    if (e.button !== 0) return;
    const p = this.hits(e, s.pressables || []);
    if (p) {
      this.press = p;
      p.onDown?.();
      e.preventDefault();
      return;
    }
    const d = this.hits(e, s.draggables || []);
    if (!d) return;
    const cam = this.app.world.camera;
    const start = d.tip();
    const normal = cam.getWorldDirection(new THREE.Vector3()).negate();
    this.drag = { d, plane: new THREE.Plane().setFromNormalAndCoplanarPoint(normal, start), offset: new THREE.Vector3() };
    this.ray.setFromCamera(this.ndc(e), cam);
    const hit = this.ray.ray.intersectPlane(this.drag.plane, new THREE.Vector3());
    if (hit) this.drag.offset.subVectors(start, hit);
    d.onGrab?.();
    e.preventDefault();
  }

  move(e) {
    if (!this.active || !this.drag) return;
    this.ray.setFromCamera(this.ndc(e), this.app.world.camera);
    const hit = this.ray.ray.intersectPlane(this.drag.plane, new THREE.Vector3());
    if (!hit) return;
    const p = hit.add(this.drag.offset);
    this.drag.d.onMove(p);
    const t = this.nearest(this.drag.d, p);
    this.marker.visible = !!t;
    if (t) {
      this.marker.position.copy(t.pos);
      this.marker.quaternion.copy(this.app.world.camera.quaternion);
      this.marker.material.color.setHex(t.ok() ? 0x55ff99 : 0xff5544);
    }
  }

  nearest(d, p) {
    const sp = this.screen(p);
    let best = null;
    let bestD = SNAP_PX;
    for (const t of d.targets()) {
      const dist = this.screen(t.pos).distanceTo(sp);
      if (dist < bestD) {
        bestD = dist;
        best = t;
      }
    }
    return best;
  }

  up(e) {
    const s = this.active;
    if (!s) return;
    if (e.button === 2) {
      s.onRight?.(false);
      return;
    }
    if (this.press) {
      this.press.onUp?.();
      this.press = null;
    }
    if (!this.drag) return;
    const d = this.drag.d;
    this.drag = null;
    this.marker.visible = false;
    const t = this.nearest(d, d.tip());
    if (t && t.ok()) t.onSnap();
    else {
      if (t && t.why) this.app.toast(t.why);
      d.onRelease?.();
    }
  }

  update(dt) {
    const s = this.active;
    if (!s) return;
    const want = s.cam?.();
    const cam = this.app.world.camera;
    if (want) {
      this.tween.k = Math.min(1, this.tween.k + dt / 0.5);
      const e = this.tween.k * this.tween.k * (3 - 2 * this.tween.k);
      const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(want.pos, want.look, new THREE.Vector3(0, 1, 0)));
      cam.position.lerpVectors(this.tween.fromPos, want.pos, e);
      cam.quaternion.slerpQuaternions(this.tween.fromQ, q, e);
      cam.fov = this.tween.fromFov + ((want.fov || 40) - this.tween.fromFov) * e;
      cam.updateProjectionMatrix();
    }
    this.app.hud.setCloseupHint(s.hint?.() || '');
  }
}

/** Move an object (possibly parented) so its origin sits at a world point. */
export function setWorldPosition(obj, p) {
  obj.parent.updateMatrixWorld(true);
  obj.position.copy(obj.parent.worldToLocal(p.clone()));
}
