// Renderer, sky, terrain, lighting and camera rig.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Sky } from 'three/examples/jsm/objects/Sky.js';

export class World {
  constructor(container) {
    this.container = container;
    const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.55;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.localClippingEnabled = true;
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    const scene = new THREE.Scene();
    this.scene = scene;
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.01, 8000);
    this.camera.position.set(1.6, 1.0, 2.2);

    this.controls = new OrbitControls(this.camera, renderer.domElement);
    this.controls.target.set(0, 0.45, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.minDistance = 0.08;
    this.controls.maxDistance = 1500;

    this.buildSky();
    this.buildLights();
    this.buildGround();
    this.buildScenery();

    this.raycaster = new THREE.Raycaster();
    this.pickables = [];
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  buildSky() {
    const sky = new Sky();
    sky.scale.setScalar(6000);
    const u = sky.material.uniforms;
    u.turbidity.value = 4;
    u.rayleigh.value = 1.4;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.8;
    this.sun = new THREE.Vector3();
    const phi = THREE.MathUtils.degToRad(90 - 38);
    const theta = THREE.MathUtils.degToRad(150);
    this.sun.setFromSphericalCoords(1, phi, theta);
    u.sunPosition.value.copy(this.sun);
    this.scene.add(sky);
    this.scene.fog = new THREE.Fog(0xb8cde0, 400, 5000);
    // environment map from the sky for nice reflections on paint and metal
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    const sky2 = new Sky();
    sky2.scale.setScalar(100);
    sky2.material.uniforms.sunPosition.value.copy(this.sun);
    sky2.material.uniforms.turbidity.value = 4;
    sky2.material.uniforms.rayleigh.value = 1.4;
    envScene.add(sky2);
    this.scene.environment = pmrem.fromScene(envScene).texture;
    this.scene.environmentIntensity = 0.6;
  }

  buildLights() {
    const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x4a5a2a, 0.9);
    this.scene.add(hemi);
    const sunLight = new THREE.DirectionalLight(0xfff1dc, 3.2);
    sunLight.position.copy(this.sun).multiplyScalar(30);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(2048, 2048);
    const sc = sunLight.shadow.camera;
    sc.left = -4;
    sc.right = 4;
    sc.top = 4;
    sc.bottom = -4;
    sc.near = 1;
    sc.far = 80;
    sunLight.shadow.bias = -0.0004;
    sunLight.shadow.normalBias = 0.02;
    this.scene.add(sunLight);
    this.scene.add(sunLight.target);
    this.sunLight = sunLight;
  }

  buildGround() {
    const size = 512;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    g.fillStyle = '#4f7a2c';
    g.fillRect(0, 0, size, size);
    // grass blades / noise
    for (let i = 0; i < 26000; i++) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const l = 30 + Math.random() * 35;
      const h = 80 + Math.random() * 30;
      g.strokeStyle = `hsla(${h}, ${40 + Math.random() * 20}%, ${l}%, ${0.25 + Math.random() * 0.4})`;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + (Math.random() - 0.5) * 3, y - 2 - Math.random() * 5);
      g.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(2000, 2000);
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    tex.colorSpace = THREE.SRGBColorSpace;
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(8000, 8000),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, metalness: 0 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);
    this.ground = ground;

    // mowed launch circle with a slightly different tone
    const ring = new THREE.Mesh(
      new THREE.CircleGeometry(3.2, 64),
      new THREE.MeshStandardMaterial({ color: 0x6f8f45, roughness: 1, transparent: true, opacity: 0.35 })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.002;
    ring.receiveShadow = true;
    this.scene.add(ring);
  }

  buildScenery() {
    // distant tree line and hills
    const trunkGeo = new THREE.CylinderGeometry(0.25, 0.35, 3, 6);
    const crownGeo = new THREE.ConeGeometry(2.6, 8, 7);
    const n = 420;
    const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x4a3524 }), n);
    const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshStandardMaterial({ color: 0x2c4a22, roughness: 1 }), n);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2;
      const r = 320 + rnd() * 900;
      const k = 0.7 + rnd() * 0.9;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      s.set(k, k, k);
      m.compose(new THREE.Vector3(x, 1.5 * k, z), q, s);
      trunks.setMatrixAt(i, m);
      m.compose(new THREE.Vector3(x, (3 + 4) * k, z), q, s);
      crowns.setMatrixAt(i, m);
    }
    this.scene.add(trunks, crowns);
    const hillMat = new THREE.MeshStandardMaterial({ color: 0x5d7a48, roughness: 1 });
    for (let i = 0; i < 9; i++) {
      const hill = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), hillMat);
      const a = (i / 9) * Math.PI * 2 + 0.3;
      hill.position.set(Math.cos(a) * 2600, -5, Math.sin(a) * 2600);
      hill.scale.set(500 + rnd() * 500, 120 + rnd() * 160, 500 + rnd() * 400);
      this.scene.add(hill);
    }
  }

  addPickable(obj, handler) {
    obj.userData.onPick = handler;
    this.pickables.push(obj);
  }

  pick(clientX, clientY) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.pickables, true);
    for (const h of hits) {
      let o = h.object;
      while (o && !o.userData.onPick) o = o.parent;
      if (o && o.visible) return { obj: o, point: h.point };
    }
    return null;
  }

  resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
