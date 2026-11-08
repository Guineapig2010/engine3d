// Range props: a folding prep table where rockets are readied.
import * as THREE from 'three';

export class PrepTable {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'PrepTable';
    this.height = 0.72;
    this.size = { x: 1.0, z: 0.55 };
    const top = new THREE.Mesh(
      new THREE.BoxGeometry(this.size.x, 0.025, this.size.z),
      new THREE.MeshStandardMaterial({ color: 0xd9d4c7, roughness: 0.75 })
    );
    top.position.y = this.height - 0.0125;
    top.castShadow = true;
    top.receiveShadow = true;
    this.group.add(top);
    const rim = new THREE.Mesh(
      new THREE.BoxGeometry(this.size.x + 0.01, 0.03, this.size.z + 0.01),
      new THREE.MeshStandardMaterial({ color: 0x5b5f66, roughness: 0.5, metalness: 0.6 })
    );
    rim.position.y = this.height - 0.03;
    this.group.add(rim);
    const legMat = new THREE.MeshStandardMaterial({ color: 0x6a6e75, roughness: 0.4, metalness: 0.8 });
    for (const sx of [-1, 1]) {
      // folding A-frame legs
      for (const sz of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, this.height * 1.02, 10), legMat);
        leg.position.set(sx * (this.size.x / 2 - 0.08), this.height / 2 - 0.02, sz * (this.size.z / 2 - 0.05));
        leg.rotation.x = sz * 0.06;
        leg.castShadow = true;
        this.group.add(leg);
      }
      const brace = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, this.size.z - 0.1, 8), legMat);
      brace.rotation.x = Math.PI / 2;
      brace.position.set(sx * (this.size.x / 2 - 0.08), 0.12, 0);
      this.group.add(brace);
    }
    // range box (field box) on the table end
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.09, 0.13), new THREE.MeshStandardMaterial({ color: 0x2d5fa8, roughness: 0.5 }));
    box.position.set(this.size.x / 2 - 0.13, this.height + 0.045, -this.size.z / 2 + 0.09);
    box.castShadow = true;
    this.group.add(box);
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.005, 6, 16, Math.PI), new THREE.MeshStandardMaterial({ color: 0x222222 }));
    handle.position.set(box.position.x, this.height + 0.09, box.position.z);
    this.group.add(handle);
  }

  /** World position of a point on the table top (local x/z offsets). */
  topPoint(x = 0, z = 0) {
    this.group.updateMatrixWorld(true);
    return this.group.localToWorld(new THREE.Vector3(x, this.height, z));
  }
}
