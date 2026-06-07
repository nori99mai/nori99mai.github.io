import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// ============================================================
// 定数
// ============================================================

const SUN_RADIUS = 3.0;
const EARTH_RADIUS = 1.15;
const MOON_RADIUS = 0.35;
const SUN_EARTH_DIST = 32;
const EARTH_MOON_DIST = 3.6;

const EARTH_AXIAL_TILT_RAD = THREE.MathUtils.degToRad(23.44);

const EARTH_ECCENTRICITY = 0.15;
const MOON_INCLINATION_RAD = THREE.MathUtils.degToRad(5.145);

const EARTH_ORBIT_PERIOD = 60;
const MOON_ORBIT_PERIOD = 5;
const EARTH_SPIN_PERIOD = 10;
const SUN_SPIN_PERIOD = 24;

const STAR_LARGE_COUNT = 50;
const STAR_MEDIUM_COUNT = 100;
const STAR_SMALL_COUNT = 150;
const STAR_TINY_COUNT = 1200;
const STAR_MICRO_COUNT = 1500;
const STAR_FIELD_RADIUS = 160;

const CLICK_THRESHOLD_PX = 14;
const CLICK_MAX_DURATION_MS = 600;

// 地上視点
const GROUND_SPEED_SCALE = 0.05;
const GROUND_DRAG_SENS   = 0.004;
const ELEVATION_MIN = THREE.MathUtils.degToRad(-85);
const ELEVATION_MAX = THREE.MathUtils.degToRad(88);

// 観測国（日本のみ名古屋）
const COUNTRIES = [
  { code: 'jp', name: 'Japan',     latDeg:  35.18, lonDeg:  136.91 },
  { code: 'us', name: 'USA',       latDeg:  38.9,  lonDeg:  -77.0  },
  { code: 'gb', name: 'UK',        latDeg:  51.5,  lonDeg:    0.0  },
  { code: 'eg', name: 'Egypt',     latDeg:  30.0,  lonDeg:   31.2  },
  { code: 'br', name: 'Brazil',    latDeg: -15.8,  lonDeg:  -47.9  },
  { code: 'au', name: 'Australia', latDeg: -33.9,  lonDeg:  151.2  }
];
let selectedCountryIdx = 0;

// ============================================================
// 初期化
// ============================================================

const canvas = document.getElementById('scene');
const monthChip = document.getElementById('month-chip');
const monthNumberEl = document.getElementById('month-number');
const monthNameEl = document.getElementById('month-name');

const MONTH_NAMES = [
  'January', 'February', 'March',     'April',
  'May',     'June',     'July',      'August',
  'September','October', 'November',  'December'
];

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000008);

const cubeLoader = new THREE.CubeTextureLoader();
cubeLoader.setPath('https://cdn.jsdelivr.net/gh/mrdoob/three.js@r160/examples/textures/cube/MilkyWay/');
cubeLoader.load(
  ['dark-s_px.jpg', 'dark-s_nx.jpg', 'dark-s_py.jpg', 'dark-s_ny.jpg', 'dark-s_pz.jpg', 'dark-s_nz.jpg'],
  (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    scene.background = tex;
    scene.backgroundIntensity = 0.35;
    scene.backgroundBlurriness = 0.25;
  }
);

const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.01,   // 地表接近に備えて near を小さく
  1200
);
camera.position.set(20, 18, 42);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

// ============================================================
// Selective Bloom
// ============================================================

const BLOOM_LAYER = 1;
const bloomLayer = new THREE.Layers();
bloomLayer.set(BLOOM_LAYER);

const renderScene = new RenderPass(scene, camera);

const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.55, 0.5, 0.0
);

const bloomComposer = new EffectComposer(renderer);
bloomComposer.renderToScreen = false;
bloomComposer.addPass(renderScene);
bloomComposer.addPass(bloomPass);

const mixShader = {
  uniforms: {
    baseTexture:  { value: null },
    bloomTexture: { value: bloomComposer.renderTarget2.texture }
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D baseTexture;
    uniform sampler2D bloomTexture;
    varying vec2 vUv;
    void main() {
      gl_FragColor = texture2D(baseTexture, vUv) + texture2D(bloomTexture, vUv);
    }
  `
};
const mixPass = new ShaderPass(new THREE.ShaderMaterial(mixShader), 'baseTexture');
mixPass.needsSwap = true;

const finalComposer = new EffectComposer(renderer);
finalComposer.setSize(window.innerWidth, window.innerHeight);
finalComposer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
bloomComposer.setSize(window.innerWidth, window.innerHeight);
bloomComposer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
finalComposer.addPass(renderScene);
finalComposer.addPass(mixPass);
finalComposer.addPass(new OutputPass());

const _hiddenVisibility = new Map();
function hideNonBloomed(obj) {
  if ((obj.isMesh || obj.isPoints || obj.isSprite || obj.isLine) &&
      bloomLayer.test(obj.layers) === false) {
    _hiddenVisibility.set(obj.uuid, obj.visible);
    obj.visible = false;
  }
}
function restoreVisibility(obj) {
  if (_hiddenVisibility.has(obj.uuid)) {
    obj.visible = _hiddenVisibility.get(obj.uuid);
    _hiddenVisibility.delete(obj.uuid);
  }
}

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 0.5;
controls.maxDistance = 140;
controls.enablePan = true;
controls.screenSpacePanning = true;
controls.panSpeed = 1.2;
controls.mouseButtons = {
  LEFT: THREE.MOUSE.ROTATE,
  MIDDLE: THREE.MOUSE.DOLLY,
  RIGHT: THREE.MOUSE.PAN
};
controls.touches = {
  ONE: THREE.TOUCH.ROTATE,
  TWO: THREE.TOUCH.DOLLY_PAN
};

// ============================================================
// ライト
// ============================================================

const sunLight = new THREE.PointLight(0xfff4dc, 3.4, 0, 0);
sunLight.position.set(0, 0, 0);
scene.add(sunLight);

const ambient = new THREE.AmbientLight(0x202838, 0.2);
scene.add(ambient);

// ============================================================
// テクスチャ
// ============================================================

const textureLoader = new THREE.TextureLoader();
textureLoader.setCrossOrigin('anonymous');

const THREE_TEXTURE_BASE = 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r160/examples/textures';

function loadColorTexture(url) {
  return new Promise((resolve) => {
    textureLoader.load(url, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
      resolve(tex);
    }, undefined, () => resolve(null));
  });
}

function loadDataTexture(url) {
  return new Promise((resolve) => {
    textureLoader.load(url, (tex) => {
      tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
      resolve(tex);
    }, undefined, () => resolve(null));
  });
}

// 太陽プロシージャルテクスチャ
function createSunTexture() {
  const size = 2048;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');

  ctx.fillStyle = '#ffa838';
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 120; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 100 + Math.random() * 260;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    const k = Math.random();
    if (k < 0.4) {
      grad.addColorStop(0, 'rgba(255, 230, 150, 0.65)');
      grad.addColorStop(1, 'rgba(255, 230, 150, 0)');
    } else if (k < 0.75) {
      grad.addColorStop(0, 'rgba(210, 80, 20, 0.55)');
      grad.addColorStop(1, 'rgba(210, 80, 20, 0)');
    } else {
      grad.addColorStop(0, 'rgba(140, 35, 10, 0.45)');
      grad.addColorStop(1, 'rgba(140, 35, 10, 0)');
    }
    ctx.fillStyle = grad;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  for (let i = 0; i < 40000; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 1 + Math.random() * 4;
    const v = Math.random();
    if (v < 0.5) {
      ctx.fillStyle = `rgba(255, ${210 + Math.random()*45 | 0}, ${90 + Math.random()*70 | 0}, ${0.25 + Math.random() * 0.30})`;
    } else {
      ctx.fillStyle = `rgba(${150 + Math.random()*50 | 0}, ${55 + Math.random()*40 | 0}, ${15 + Math.random()*30 | 0}, ${0.25 + Math.random() * 0.25})`;
    }
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  for (let i = 0; i < 90; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 20 + Math.random() * 60;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(255, 248, 200, 0.75)');
    grad.addColorStop(0.4, 'rgba(255, 200, 110, 0.40)');
    grad.addColorStop(1, 'rgba(255, 200, 110, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  for (let i = 0; i < 22; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 10 + Math.random() * 28;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(30, 10, 0, 0.95)');
    grad.addColorStop(0.55, 'rgba(90, 35, 10, 0.55)');
    grad.addColorStop(1, 'rgba(120, 50, 15, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// ============================================================
// 太陽
// ============================================================

const sun = new THREE.Mesh(
  new THREE.SphereGeometry(SUN_RADIUS, 64, 64),
  new THREE.MeshBasicMaterial({ map: createSunTexture(), transparent: false, depthWrite: true })
);
scene.add(sun);

const sunRim = new THREE.Mesh(
  new THREE.SphereGeometry(SUN_RADIUS * 1.003, 96, 96),
  new THREE.ShaderMaterial({
    uniforms: { glowColor: { value: new THREE.Color(0xffd870) } },
    vertexShader: /* glsl */`
      varying vec3 vNormal;
      varying vec3 vViewDir;
      void main() {
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        vNormal  = normalize(normalMatrix * normal);
        vViewDir = normalize(-mvPos.xyz);
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: /* glsl */`
      uniform vec3 glowColor;
      varying vec3 vNormal;
      varying vec3 vViewDir;
      void main() {
        float ndv = max(0.0, dot(vNormal, vViewDir));
        float rim = pow(1.0 - ndv, 2.6);
        gl_FragColor = vec4(glowColor * rim * 1.6, rim * 0.85);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.FrontSide
  })
);
sun.add(sunRim);
sun.traverse((o) => o.layers.enable(BLOOM_LAYER));

// ============================================================
// 地球
// ============================================================

const earthHolder = new THREE.Object3D();
scene.add(earthHolder);

const earthTilt = new THREE.Object3D();
earthTilt.rotation.z = EARTH_AXIAL_TILT_RAD;
earthHolder.add(earthTilt);

const earth = new THREE.Mesh(
  new THREE.SphereGeometry(EARTH_RADIUS, 64, 64),
  new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.65,
    metalness: 0.0,
    transparent: true,
    opacity: 0.68,
    depthWrite: false
  })
);
earthTilt.add(earth);

// ============================================================
// 月
// ============================================================

const moonTilt = new THREE.Object3D();
moonTilt.rotation.z = MOON_INCLINATION_RAD;
scene.add(moonTilt);

const moonOrbit = new THREE.Object3D();
moonTilt.add(moonOrbit);

const moon = new THREE.Mesh(
  new THREE.SphereGeometry(MOON_RADIUS, 48, 48),
  new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.95,
    metalness: 0.0,
    transparent: true,
    opacity: 0.80,
    depthWrite: false
  })
);
moon.position.set(EARTH_MOON_DIST, 0, 0);
moonOrbit.add(moon);

// ============================================================
// 軌道線
// ============================================================

function makeEarthOrbitRing() {
  const segments = 256;
  const points = [];
  const a = SUN_EARTH_DIST;
  const b = a * Math.sqrt(1 - EARTH_ECCENTRICITY * EARTH_ECCENTRICITY);
  for (let i = 0; i <= segments; i++) {
    const theta = (i / segments) * Math.PI * 2;
    points.push(new THREE.Vector3(a * Math.cos(theta), 0, -b * Math.sin(theta)));
  }
  const geom = new THREE.BufferGeometry().setFromPoints(points);
  return new THREE.Line(geom, new THREE.LineBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.18, depthWrite: false
  }));
}
scene.add(makeEarthOrbitRing());

function makeMoonOrbitRing() {
  const segments = 192;
  const points = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    points.push(new THREE.Vector3(Math.cos(a) * EARTH_MOON_DIST, 0, Math.sin(a) * EARTH_MOON_DIST));
  }
  const geom = new THREE.BufferGeometry().setFromPoints(points);
  return new THREE.Line(geom, new THREE.LineBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.14, depthWrite: false
  }));
}
moonTilt.add(makeMoonOrbitRing());

// ============================================================
// テクスチャ非同期読み込み
// ============================================================

(async () => {
  const [earthColor, earthNormal, earthSpec, moonColor, moonBump] = await Promise.all([
    loadColorTexture(`${THREE_TEXTURE_BASE}/planets/earth_atmos_2048.jpg`),
    loadDataTexture(`${THREE_TEXTURE_BASE}/planets/earth_normal_2048.jpg`),
    loadDataTexture(`${THREE_TEXTURE_BASE}/planets/earth_specular_2048.jpg`),
    loadColorTexture(`${THREE_TEXTURE_BASE}/planets/moon_1024.jpg`),
    loadDataTexture(`${THREE_TEXTURE_BASE}/planets/moon_1024.jpg`)
  ]);
  if (earthColor) earth.material.map = earthColor;
  if (earthNormal) { earth.material.normalMap = earthNormal; earth.material.normalScale.set(0.8, 0.8); }
  if (earthSpec)   { earth.material.roughnessMap = earthSpec; earth.material.metalnessMap = earthSpec; }
  earth.material.needsUpdate = true;

  if (moonColor) moon.material.map = moonColor;
  if (moonBump)  { moon.material.bumpMap = moonBump; moon.material.bumpScale = 0.02; }
  moon.material.needsUpdate = true;
})();

// ============================================================
// 星空
// ============================================================

function createSoftDiscTexture() {
  const size = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(cv);
}

function createCrossStarTexture() {
  const size = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');

  const g = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size * 0.22);
  g.addColorStop(0, 'rgba(255, 255, 255, 1)');
  g.addColorStop(0.35, 'rgba(255, 255, 255, 0.55)');
  g.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);

  ctx.globalCompositeOperation = 'lighter';
  function drawSpike(angle, thickness, length, intensity) {
    ctx.save();
    ctx.translate(size/2, size/2);
    ctx.rotate(angle);
    const grad = ctx.createLinearGradient(-size/2, 0, size/2, 0);
    const startCut = 0.5 - length * 0.5;
    const endCut   = 0.5 + length * 0.5;
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(startCut, 'rgba(255,255,255,0)');
    grad.addColorStop(0.49, `rgba(255,255,255,${intensity * 0.45})`);
    grad.addColorStop(0.50, `rgba(255,255,255,${intensity})`);
    grad.addColorStop(0.51, `rgba(255,255,255,${intensity * 0.45})`);
    grad.addColorStop(endCut, 'rgba(255,255,255,0)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(-size/2, -thickness/2, size, thickness);
    ctx.restore();
  }
  drawSpike(0,            1.5, 0.95, 0.85);
  drawSpike(Math.PI / 2,  1.5, 0.95, 0.85);
  drawSpike(Math.PI / 4,  1.0, 0.55, 0.35);
  drawSpike(-Math.PI / 4, 1.0, 0.55, 0.35);

  return new THREE.CanvasTexture(cv);
}

const STAR_BAND_TILT_X = THREE.MathUtils.degToRad(28);
const STAR_BAND_TILT_Z = THREE.MathUtils.degToRad(15);
const STAR_DISC_TEXTURE  = createSoftDiscTexture();
const STAR_CROSS_TEXTURE = createCrossStarTexture();

function sampleStarPosition(bandBias, rMin = 0.6, rMax = 1.0) {
  const u = Math.random();
  const v = Math.random();
  const theta = 2 * Math.PI * u;
  let phi;
  if (Math.random() < bandBias) {
    phi = Math.PI / 2 + (Math.random() - 0.5) * (Math.PI / 7);
  } else {
    phi = Math.acos(2 * v - 1);
  }
  const r = STAR_FIELD_RADIUS * (rMin + Math.random() * (rMax - rMin));
  let x = r * Math.sin(phi) * Math.cos(theta);
  let y = r * Math.sin(phi) * Math.sin(theta);
  let z = r * Math.cos(phi);
  const cx = Math.cos(STAR_BAND_TILT_X), sx = Math.sin(STAR_BAND_TILT_X);
  const ny = y * cx - z * sx;
  const nz = y * sx + z * cx;
  y = ny; z = nz;
  const cz = Math.cos(STAR_BAND_TILT_Z), sz = Math.sin(STAR_BAND_TILT_Z);
  const nx2 = x * cz - y * sz;
  const ny2 = x * sz + y * cz;
  return { x: nx2, y: ny2, z };
}

function sampleStarColor() {
  const tone = Math.random();
  let r0, g0, b0;
  if (tone < 0.55)      { r0 = 1.0;  g0 = 1.0;  b0 = 1.0; }
  else if (tone < 0.8)  { r0 = 0.78; g0 = 0.86; b0 = 1.0; }
  else                  { r0 = 1.0;  g0 = 0.92; b0 = 0.75; }
  const brightness = 0.55 + Math.random() * 0.45;
  return { r: r0 * brightness, g: g0 * brightness, b: b0 * brightness };
}

function createStarLayer(count, sizePx, opacity, bandBias, rMin = 0.6, rMax = 1.0, useCross = false) {
  const positions = new Float32Array(count * 3);
  const colors    = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const p = sampleStarPosition(bandBias, rMin, rMax);
    positions[i*3] = p.x; positions[i*3+1] = p.y; positions[i*3+2] = p.z;
    const c = sampleStarColor();
    colors[i*3] = c.r; colors[i*3+1] = c.g; colors[i*3+2] = c.b;
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('color',    new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({
    size: sizePx, sizeAttenuation: false,
    transparent: true, opacity,
    depthWrite: false, vertexColors: true,
    blending: THREE.AdditiveBlending,
    map: useCross ? STAR_CROSS_TEXTURE : STAR_DISC_TEXTURE
  });
  return new THREE.Points(geom, mat);
}

function createHardDotLayer(count, sizePx, opacity, bandBias, rMin = 0.6, rMax = 1.0) {
  const positions = new Float32Array(count * 3);
  const colors    = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const p = sampleStarPosition(bandBias, rMin, rMax);
    positions[i*3] = p.x; positions[i*3+1] = p.y; positions[i*3+2] = p.z;
    const c = sampleStarColor();
    colors[i*3] = c.r; colors[i*3+1] = c.g; colors[i*3+2] = c.b;
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('color',    new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({
    size: sizePx, sizeAttenuation: false,
    transparent: true, opacity, depthWrite: false, vertexColors: true
  });
  return new THREE.Points(geom, mat);
}

scene.add(createStarLayer(STAR_LARGE_COUNT,  6.0, 1.0,  0.45, 0.85, 1.00, true));
scene.add(createStarLayer(STAR_MEDIUM_COUNT, 4.0, 0.95, 0.40, 0.85, 1.00));
scene.add(createStarLayer(STAR_SMALL_COUNT,  2.2, 0.80, 0.35, 0.85, 1.00));
scene.add(createHardDotLayer(STAR_TINY_COUNT,  1.6, 0.9,  0.30, 0.85, 1.00));
scene.add(createHardDotLayer(STAR_MICRO_COUNT, 1.0, 0.65, 0.25, 0.85, 1.00));
scene.add(createStarLayer( 80, 5.0, 0.90, 0.42, 0.55, 0.78, true));
scene.add(createStarLayer(220, 2.6, 0.85, 0.38, 0.55, 0.78));
scene.add(createHardDotLayer(500, 1.3, 0.75, 0.30, 0.55, 0.78));
scene.add(createStarLayer( 35, 7.5, 0.95, 0.50, 0.36, 0.50, true));
scene.add(createStarLayer(110, 3.4, 0.85, 0.42, 0.36, 0.50));
scene.add(createHardDotLayer(220, 1.5, 0.70, 0.32, 0.36, 0.50));

function createBrightStars() {
  const group = new THREE.Group();
  const tex = STAR_CROSS_TEXTURE;
  for (let i = 0; i < 14; i++) {
    const u = Math.random();
    const v = Math.random();
    const theta = 2 * Math.PI * u;
    const phi = Math.acos(2 * v - 1);
    const r = STAR_FIELD_RADIUS * 0.88;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex,
      color: i % 3 === 0 ? 0xfff4d0 : (i % 3 === 1 ? 0xd6e6ff : 0xffffff),
      transparent: true, opacity: 0.95,
      depthWrite: false, blending: THREE.AdditiveBlending
    }));
    sprite.position.set(
      r * Math.sin(phi) * Math.cos(theta),
      r * Math.sin(phi) * Math.sin(theta),
      r * Math.cos(phi)
    );
    const s = 1.5 + Math.random() * 2.5;
    sprite.scale.set(s, s, 1);
    group.add(sprite);
  }
  return group;
}
scene.add(createBrightStars());

function createNebulaHaze() {
  const group = new THREE.Group();
  const colors = [0x3a4a8a, 0x6a3a8a, 0x2a5a8a, 0x4a3a7a, 0x5a4a9a];
  const tex = createSoftDiscTexture();
  const bandTiltX = THREE.MathUtils.degToRad(28);
  const bandTiltZ = THREE.MathUtils.degToRad(15);
  for (let i = 0; i < 14; i++) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, color: colors[i % colors.length],
      transparent: true, opacity: 0.07 + Math.random() * 0.07,
      depthWrite: false, blending: THREE.AdditiveBlending
    }));
    const theta = Math.random() * Math.PI * 2;
    const r = STAR_FIELD_RADIUS * 0.72;
    let x = r * Math.cos(theta);
    let y = (Math.random() - 0.5) * STAR_FIELD_RADIUS * 0.15;
    let z = r * Math.sin(theta);
    const cx = Math.cos(bandTiltX), sx = Math.sin(bandTiltX);
    const ny = y * cx - z * sx;
    const nz = y * sx + z * cx;
    y = ny; z = nz;
    const cz = Math.cos(bandTiltZ), sz = Math.sin(bandTiltZ);
    const nx2 = x * cz - y * sz;
    const ny2 = x * sz + y * cz;
    x = nx2; y = ny2;
    sprite.position.set(x, y, z);
    const s = STAR_FIELD_RADIUS * (0.5 + Math.random() * 0.6);
    sprite.scale.set(s, s, 1);
    group.add(sprite);
  }
  return group;
}
scene.add(createNebulaHaze());

// ============================================================
// TODAY ボタン
// ============================================================

const NEW_MOON_EPOCH_MS  = Date.UTC(2000, 0, 6, 18, 14, 0);
const SYNODIC_MONTH_DAYS = 29.530588853;

function moonPhaseAt(dateMs) {
  const days = (dateMs - NEW_MOON_EPOCH_MS) / 86400000;
  let p = (days / SYNODIC_MONTH_DAYS) % 1;
  if (p < 0) p += 1;
  return p;
}

function phaseToMoonAngle(phase) {
  return (phase - 0.5) * Math.PI * 2;
}

function earthAngleForDate(date) {
  const m = date.getMonth();
  const d = date.getDate();
  const daysInMonth = new Date(date.getFullYear(), m + 1, 0).getDate();
  const monthFrac = (d - 1) / daysInMonth;
  return ((m + monthFrac) / 12) * Math.PI * 2;
}

function setSceneToToday() {
  const now = new Date();
  earthAngle = earthAngleForDate(now);
  moonAngle  = phaseToMoonAngle(moonPhaseAt(now.getTime()));
  earthSpin  = 0;
  sunSpin    = 0;

  isPlaying = false;
  const m = ((Math.floor(earthAngle / (Math.PI * 2 / 12)) % 12) + 12) % 12 + 1;
  monthNumberEl.textContent = String(m);
  if (monthNameEl) monthNameEl.textContent = MONTH_NAMES[m - 1];
  monthChip.classList.remove('hidden');

  showTodayDateFlash(now);
}

const todayDateEl = document.getElementById('today-date');
let _todayDateTimer = null;

function showTodayDateFlash(date) {
  if (!todayDateEl) return;
  todayDateEl.textContent = `${date.getMonth() + 1}/${date.getDate()}`;
  todayDateEl.classList.remove('hidden');
  requestAnimationFrame(() => { todayDateEl.classList.add('show'); });
  clearTimeout(_todayDateTimer);
  _todayDateTimer = setTimeout(() => {
    todayDateEl.classList.remove('show');
    setTimeout(() => todayDateEl.classList.add('hidden'), 600);
  }, 2200);
}

const todayBtn = document.getElementById('today-btn');
if (todayBtn) {
  todayBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    setSceneToToday();
    todayBtn.classList.add('is-active');
  });
}

function clearTodayHighlight() {
  if (todayBtn) todayBtn.classList.remove('is-active');
}

// ============================================================
// 状態
// ============================================================

let isPlaying = true;
let earthAngle = 0;
let moonAngle  = 0;
let earthSpin  = 0;
let sunSpin    = 0;
let speedScale = 1.0;

let focusTarget = sun;
const focusables = [sun, earth, moon];
const raycaster = new THREE.Raycaster();
const _ndc    = new THREE.Vector2();
const _tmpVec = new THREE.Vector3();

// ============================================================
// 地上視点モード
// ============================================================

let viewMode = 'space'; // 'space' | 'ground' | 'transitioning'

let groundAzimuth   = 0;
let groundElevation = THREE.MathUtils.degToRad(20); // 初期：少し上を向く

// ドラッグ管理
let groundDragActive = false;
let groundDragLast   = null;

// カメラトランジション
let camTransition = null;
// { fromPos, toPos?, fromUp?, toUp?, t, duration, isEntering, onComplete }

// 宇宙視点のカメラ位置（地上移行前に保存して復元に使う）
let savedSpaceCamPos    = null;
let savedSpaceCamTarget = null;

// 緯度経度 → 地球ローカル座標
function latLonToVec3(latDeg, lonDeg, radius) {
  const lat = THREE.MathUtils.degToRad(latDeg);
  const lon = THREE.MathUtils.degToRad(lonDeg);
  return new THREE.Vector3(
    radius * Math.cos(lat) * Math.cos(lon),
    radius * Math.sin(lat),
    -radius * Math.cos(lat) * Math.sin(lon)
  );
}

// 現在の観測国の地表世界座標・天頂方向を取得
function getObserverWorldState() {
  earth.updateMatrixWorld();
  const c = COUNTRIES[selectedCountryIdx];
  const localPos = latLonToVec3(c.latDeg, c.lonDeg, EARTH_RADIUS * 1.05);
  const worldPos  = localPos.clone().applyMatrix4(earth.matrixWorld);
  const earthPos  = new THREE.Vector3();
  earth.getWorldPosition(earthPos);
  const upDir = worldPos.clone().sub(earthPos).normalize();
  return { worldPos, upDir };
}

// 地上視点：視線方向の lookAt ターゲットを計算
function computeGroundLookTarget(obsPos, upDir) {
  const worldY = new THREE.Vector3(0, 1, 0);
  let northDir = worldY.clone().addScaledVector(upDir, -worldY.dot(upDir));
  if (northDir.lengthSq() < 1e-6) {
    northDir.set(1, 0, 0).addScaledVector(upDir, -upDir.x);
  }
  northDir.normalize();
  const eastDir = new THREE.Vector3().crossVectors(northDir, upDir).normalize();

  const h = Math.cos(groundElevation);
  const v = Math.sin(groundElevation);
  const lookDir = new THREE.Vector3()
    .addScaledVector(northDir, h * Math.cos(groundAzimuth))
    .addScaledVector(eastDir,  h * Math.sin(groundAzimuth))
    .addScaledVector(upDir,    v)
    .normalize();
  return obsPos.clone().addScaledVector(lookDir, 10);
}

function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

// 着地ボタンの表示制御
function updateLandBtnVisibility() {
  const landBtn = document.getElementById('land-btn');
  if (!landBtn) return;
  const show = focusTarget === earth && viewMode === 'space';
  landBtn.classList.toggle('hidden', !show);
}

// 地上視点へ移行開始
function enterGroundView() {
  if (viewMode !== 'space') return;
  viewMode = 'transitioning';
  speedScale = GROUND_SPEED_SCALE;
  controls.enabled = false;

  // 宇宙カメラ位置を保存（復帰時に使う）
  savedSpaceCamPos    = camera.position.clone();
  savedSpaceCamTarget = controls.target.clone();

  const fromPos = camera.position.clone();
  camTransition = {
    fromPos,
    t: 0,
    duration: 1.1,
    isEntering: true,
    onComplete: () => {
      viewMode = 'ground';
      document.getElementById('ground-ui').classList.remove('hidden');
    }
  };

  document.getElementById('land-btn').classList.add('hidden');
}

// 宇宙視点へ復帰開始
function exitGroundView() {
  if (viewMode !== 'ground') return;
  viewMode = 'transitioning';

  document.getElementById('ground-ui').classList.add('hidden');

  const fromPos = camera.position.clone();
  const fromUp  = camera.up.clone();

  // 保存した宇宙カメラ位置に戻る（保存がなければ地球の正面に）
  let toPos;
  if (savedSpaceCamPos) {
    toPos = savedSpaceCamPos.clone();
  } else {
    const earthPos = new THREE.Vector3();
    earth.getWorldPosition(earthPos);
    toPos = earthPos.clone().add(new THREE.Vector3(0, 3, 7));
  }

  camTransition = {
    fromPos,
    toPos,
    fromUp,
    toUp: new THREE.Vector3(0, 1, 0),
    t: 0,
    duration: 1.1,
    isEntering: false,
    onComplete: () => {
      viewMode = 'space';
      speedScale = 1.0;
      controls.enabled = true;
      // 地球の現在位置をターゲットに（公転でずれていても正確に追う）
      earth.getWorldPosition(_tmpVec);
      controls.target.copy(_tmpVec);
      updateLandBtnVisibility();
    }
  };
}

// カメラトランジション（毎フレーム）
function updateCameraTransition(dt) {
  if (!camTransition) return;
  camTransition.t = Math.min(camTransition.t + dt / camTransition.duration, 1.0);
  const easedT = easeInOut(camTransition.t);

  if (camTransition.isEntering) {
    const { worldPos, upDir } = getObserverWorldState();
    camera.position.lerpVectors(camTransition.fromPos, worldPos, easedT);
    camera.up.lerp(upDir, easedT * 1.2 > 1 ? 1 : easedT * 1.2);
    camera.lookAt(computeGroundLookTarget(camera.position, upDir));
  } else {
    camera.position.lerpVectors(camTransition.fromPos, camTransition.toPos, easedT);
    camera.up.lerpVectors(camTransition.fromUp, camTransition.toUp, easedT);
    const earthPos = new THREE.Vector3();
    earth.getWorldPosition(earthPos);
    camera.lookAt(earthPos);
  }

  if (camTransition.t >= 1.0) {
    const cb = camTransition.onComplete;
    camTransition = null;
    if (cb) cb();
  }
}

// 地上視点カメラ（毎フレーム）
function updateGroundCamera() {
  if (viewMode !== 'ground') return;
  const { worldPos, upDir } = getObserverWorldState();
  camera.position.copy(worldPos);
  camera.up.copy(upDir);
  camera.lookAt(computeGroundLookTarget(worldPos, upDir));
}

// 地上視点の国旗UI セットアップ（1枚表示→クリックで展開）
function setupGroundFlags() {
  const currentBtn = document.getElementById('ground-flag-current');
  const menu       = document.getElementById('ground-flag-menu');
  if (!currentBtn || !menu) return;

  const currentImg = currentBtn.querySelector('img');

  function refreshCurrent() {
    const c = COUNTRIES[selectedCountryIdx];
    currentImg.src = `https://flagcdn.com/${c.code}.svg`;
    currentImg.alt = c.name;
    currentBtn.setAttribute('aria-label', `観測国: ${c.name}（クリックで切替）`);
  }

  function buildMenu() {
    menu.innerHTML = '';
    COUNTRIES.forEach((c, idx) => {
      if (idx === selectedCountryIdx) return;
      const btn = document.createElement('button');
      btn.className = 'ground-flag-btn';
      btn.setAttribute('aria-label', c.name);
      const img = document.createElement('img');
      img.src = `https://flagcdn.com/${c.code}.svg`;
      img.alt = c.name;
      img.loading = 'eager';
      img.decoding = 'async';
      btn.appendChild(img);
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        selectedCountryIdx = idx;
        groundAzimuth = 0;
        refreshCurrent();
        buildMenu();
        closeMenu();
      });
      menu.appendChild(btn);
    });
  }

  function openMenu()  { menu.classList.remove('hidden'); }
  function closeMenu() { menu.classList.add('hidden'); }

  currentBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.classList.contains('hidden') ? openMenu() : closeMenu();
  });

  // ground-ui 外クリックでメニューを閉じる
  document.addEventListener('click', () => {
    if (!menu.classList.contains('hidden')) closeMenu();
  });
  document.addEventListener('touchstart', () => {
    if (!menu.classList.contains('hidden')) closeMenu();
  }, { passive: true });

  refreshCurrent();
  buildMenu();
  closeMenu();
}
setupGroundFlags();

// ボタンイベント
const landBtnEl = document.getElementById('land-btn');
if (landBtnEl) {
  landBtnEl.addEventListener('click', (e) => { e.stopPropagation(); enterGroundView(); });
}
const jumpBtnEl = document.getElementById('jump-btn');
if (jumpBtnEl) {
  jumpBtnEl.addEventListener('click', (e) => { e.stopPropagation(); exitGroundView(); });
}
// ground-ui 全体からキャンバスへのイベント伝播防止
const groundUiEl = document.getElementById('ground-ui');
if (groundUiEl) {
  ['mousedown','mouseup','click','touchstart','touchend','pointerdown','pointerup'].forEach((ev) => {
    groundUiEl.addEventListener(ev, (e) => e.stopPropagation());
  });
}
// today-btn からのイベント伝播防止（既にclickでstopPropagationしているが念のため）
if (todayBtn) {
  ['mousedown','touchstart','pointerdown'].forEach((ev) => {
    todayBtn.addEventListener(ev, (e) => e.stopPropagation());
  });
}

// ============================================================
// 楕円軌道・月追従
// ============================================================

function updateEarthPosition() {
  const a = SUN_EARTH_DIST;
  const b = a * Math.sqrt(1 - EARTH_ECCENTRICITY * EARTH_ECCENTRICITY);
  earthHolder.position.x = a * Math.cos(earthAngle);
  earthHolder.position.y = 0;
  earthHolder.position.z = -b * Math.sin(earthAngle);
}

function syncMoonSystemToEarth() {
  moonTilt.position.copy(earthHolder.position);
}

// ============================================================
// 月数算出
// ============================================================

function currentMonth() {
  const normalized = ((earthAngle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const m = Math.floor(normalized / (Math.PI * 2 / 12)) + 1;
  return Math.min(12, Math.max(1, m));
}

// ============================================================
// フォーカス
// ============================================================

function updateFocus() {
  if (!focusTarget) return;
  focusTarget.getWorldPosition(_tmpVec);
  controls.target.copy(_tmpVec);
  updateLandBtnVisibility();
}

// ============================================================
// アニメーション
// ============================================================

const clock = new THREE.Clock();

function animate() {
  const dt = clock.getDelta();

  if (isPlaying) {
    earthAngle += (Math.PI * 2 / EARTH_ORBIT_PERIOD) * dt * speedScale;
    moonAngle  += (Math.PI * 2 / MOON_ORBIT_PERIOD)  * dt * speedScale;
    earthSpin  += (Math.PI * 2 / EARTH_SPIN_PERIOD)  * dt * speedScale;
    sunSpin    += (Math.PI * 2 / SUN_SPIN_PERIOD)    * dt * speedScale;
  }

  updateEarthPosition();
  earth.rotation.y  = earthSpin;
  sun.rotation.y    = sunSpin;
  moonOrbit.rotation.y = moonAngle;
  moon.rotation.y   = 0;
  syncMoonSystemToEarth();

  if (camTransition) {
    updateCameraTransition(dt);
  } else if (viewMode === 'ground') {
    updateGroundCamera();
  } else {
    updateFocus();
    controls.update();
  }

  renderSelectiveBloom();
  requestAnimationFrame(animate);
}

function renderSelectiveBloom() {
  const savedBg = scene.background;
  scene.background = null;
  scene.traverse(hideNonBloomed);
  bloomComposer.render();
  scene.traverse(restoreVisibility);
  scene.background = savedBg;
  finalComposer.render();
}

animate();

// ============================================================
// クリック / タップ：停止・再生トグル、ダブルクリックでフォーカス
// ============================================================

let pointerDown  = null;
let lastClickTime = 0;
let pendingSingleClick = null;
const DOUBLE_CLICK_MS = 280;

function onPointerDown(e) {
  const p = pointerFromEvent(e);
  pointerDown = { x: p.x, y: p.y, t: performance.now() };
  if (viewMode === 'ground') {
    groundDragActive = false;
    groundDragLast   = { x: p.x, y: p.y };
  }
}

function onPointerMove(e) {
  if (viewMode !== 'ground' || !pointerDown) return;
  const p = pointerFromEvent(e);

  if (!groundDragActive) {
    const totalDist = Math.hypot(p.x - pointerDown.x, p.y - pointerDown.y);
    if (totalDist > 4) groundDragActive = true;
  }

  if (groundDragActive && groundDragLast) {
    const dx = p.x - groundDragLast.x;
    const dy = p.y - groundDragLast.y;
    groundAzimuth   += dx * GROUND_DRAG_SENS;
    groundElevation  = THREE.MathUtils.clamp(
      groundElevation - dy * GROUND_DRAG_SENS,
      ELEVATION_MIN, ELEVATION_MAX
    );
  }
  groundDragLast = { x: p.x, y: p.y };
}

function onPointerUp(e) {
  const dragWasActive = groundDragActive;
  groundDragActive = false;
  groundDragLast   = null;

  if (!pointerDown) return;
  const p = pointerFromEvent(e);
  const dx = p.x - pointerDown.x;
  const dy = p.y - pointerDown.y;
  const dist    = Math.hypot(dx, dy);
  const elapsed = performance.now() - pointerDown.t;
  pointerDown = null;

  if (dist > CLICK_THRESHOLD_PX || elapsed >= CLICK_MAX_DURATION_MS || dragWasActive) return;

  const now = performance.now();
  if (now - lastClickTime < DOUBLE_CLICK_MS) {
    if (pendingSingleClick) { clearTimeout(pendingSingleClick); pendingSingleClick = null; }
    lastClickTime = 0;
    handleDoubleClick(p);
  } else {
    lastClickTime = now;
    pendingSingleClick = setTimeout(() => {
      togglePlay();
      pendingSingleClick = null;
    }, DOUBLE_CLICK_MS);
  }
}

function handleDoubleClick(p) {
  if (viewMode !== 'space') return;
  _ndc.x = (p.x / window.innerWidth)  * 2 - 1;
  _ndc.y = -(p.y / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(_ndc, camera);
  const hits = raycaster.intersectObjects(focusables, false);
  if (hits.length > 0) {
    focusTarget = hits[0].object;
    updateLandBtnVisibility();
  }
}

function pointerFromEvent(e) {
  if (e.changedTouches && e.changedTouches.length) {
    const t = e.changedTouches[0];
    return { x: t.clientX, y: t.clientY };
  }
  return { x: e.clientX, y: e.clientY };
}

function togglePlay() {
  isPlaying = !isPlaying;
  if (isPlaying) {
    monthChip.classList.add('hidden');
    clearTodayHighlight();
  } else {
    const m = currentMonth();
    monthNumberEl.textContent = String(m);
    if (monthNameEl) monthNameEl.textContent = MONTH_NAMES[m - 1];
    monthChip.classList.remove('hidden');
  }
}

canvas.addEventListener('mousedown',  onPointerDown);
canvas.addEventListener('mousemove',  onPointerMove);
canvas.addEventListener('mouseup',    onPointerUp);
canvas.addEventListener('touchstart', onPointerDown, { passive: true });
canvas.addEventListener('touchmove',  onPointerMove, { passive: true });
canvas.addEventListener('touchend',   onPointerUp);

// ============================================================
// リサイズ
// ============================================================

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  bloomComposer.setSize(window.innerWidth, window.innerHeight);
  finalComposer.setSize(window.innerWidth, window.innerHeight);
  bloomPass.resolution.set(window.innerWidth, window.innerHeight);
});
