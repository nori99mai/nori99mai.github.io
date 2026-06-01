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
const SUN_EARTH_DIST = 32;        // 楕円の長半径 a
const EARTH_MOON_DIST = 3.6;

// 地球の自転軸の傾き（黄道面に対して 23.44°）
const EARTH_AXIAL_TILT_RAD = THREE.MathUtils.degToRad(23.44);

// 軌道パラメータ
// 月の傾きは NASA 実測値（5.145°）。地球公転の離心率は実測 0.0167 だが
// 視覚的にほぼ円になるためデフォルメ値（0.15）に拡大。
// 楕円の「焦点」ではなく「中心」を太陽位置にする（視覚バランス優先のデフォルメ）。
const EARTH_ECCENTRICITY = 0.15;
const MOON_INCLINATION_RAD = THREE.MathUtils.degToRad(5.145);

const EARTH_ORBIT_PERIOD = 60;
const MOON_ORBIT_PERIOD = 5;
const EARTH_SPIN_PERIOD = 10;
const SUN_SPIN_PERIOD = 24;  // 太陽の自転（実際は約25日、視認できるようデフォルメ）

// 星空は大小4レイヤーで遠近感を出す
const STAR_LARGE_COUNT = 50;
const STAR_MEDIUM_COUNT = 100;
const STAR_SMALL_COUNT = 150;
const STAR_TINY_COUNT = 1200;
const STAR_MICRO_COUNT = 1500;
const STAR_FIELD_RADIUS = 160;

const BODY_OPACITY = 0.62;
// タップ判定：スマホで地球をフォーカス中もカメラが微小に動くため、
// 厳しすぎるとタップが drag 扱いになる。閾値・時間どちらも余裕を持たせる
const CLICK_THRESHOLD_PX = 14;
const CLICK_MAX_DURATION_MS = 600;

// 観測国（初期セット：北半球高/中/低緯度＋南半球中緯度）
const COUNTRIES = [
  { code: 'jp', name: 'Japan',     latDeg:  35.7, lonDeg:  139.7 },
  { code: 'us', name: 'USA',       latDeg:  40.7, lonDeg:  -74.0 },
  { code: 'gb', name: 'UK',        latDeg:  51.5, lonDeg:    0.0 },
  { code: 'eg', name: 'Egypt',     latDeg:  30.0, lonDeg:   31.2 },
  { code: 'br', name: 'Brazil',    latDeg: -22.9, lonDeg:  -43.2 },
  { code: 'au', name: 'Australia', latDeg: -33.9, lonDeg:  151.2 }
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

// 背景：天の川キューブマップを奥に薄く重ねる。チープさを抑えるため
// backgroundIntensity で輝度を下げ、backgroundBlurriness で滲ませる。
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
  0.1,
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
// Selective Bloom：太陽（とコロナ）だけにブルームをかける
// ============================================================

const BLOOM_LAYER = 1;
const bloomLayer = new THREE.Layers();
bloomLayer.set(BLOOM_LAYER);

const renderScene = new RenderPass(scene, camera);

const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  1.1,    // strength（太陽が「光ってる感」を出すため強め）
  0.85,   // radius（広く滲ませる）
  0.0     // threshold（このコンポーザーには太陽しか映らないので閾値は0でOK）
);

// 1段目：太陽だけを描画してブルームをかける
const bloomComposer = new EffectComposer(renderer);
bloomComposer.renderToScreen = false;
bloomComposer.addPass(renderScene);
bloomComposer.addPass(bloomPass);

// 2段目：通常描画した上に、bloomComposer の結果を加算合成
const mixShader = {
  uniforms: {
    baseTexture: { value: null },
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

// ブルームレンダリング時、太陽以外を非表示にするためのヘルパー
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

// 太陽光（PointLight）：距離減衰を無効化（decay=0）して、太陽から離れた地球までしっかり照らす
// 物理的には不正確だが、子供向けに「光がどこに当たっているか」を強調するための判断
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

// three.js 公式リポジトリの公開テクスチャ（NASA Visible Earth系の派生）を jsdelivr 経由で読み込み
const THREE_TEXTURE_BASE = 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r160/examples/textures';

function loadColorTexture(url) {
  return new Promise((resolve) => {
    textureLoader.load(
      url,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
        resolve(tex);
      },
      undefined,
      () => resolve(null)
    );
  });
}

function loadDataTexture(url) {
  return new Promise((resolve) => {
    textureLoader.load(
      url,
      (tex) => {
        tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
        resolve(tex);
      },
      undefined,
      () => resolve(null)
    );
  });
}

// 太陽用プロシージャルテクスチャ：グラニュレーション・プロミネンス・黒点
function createSunTexture() {
  const size = 2048;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');

  // ベース：濃いめのオレンジ。コントラストを強めて「太陽らしさ」を出す
  ctx.fillStyle = '#ff8a1c';
  ctx.fillRect(0, 0, size, size);

  // 1. 大規模な色のうねり（低周波ノイズ感）— 明暗のコントラストを強める
  for (let i = 0; i < 120; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 100 + Math.random() * 260;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    const k = Math.random();
    if (k < 0.4) {
      // 明るい黄色のうねり
      grad.addColorStop(0, 'rgba(255, 230, 150, 0.65)');
      grad.addColorStop(1, 'rgba(255, 230, 150, 0)');
    } else if (k < 0.75) {
      // 濃いオレンジのうねり
      grad.addColorStop(0, 'rgba(210, 80, 20, 0.55)');
      grad.addColorStop(1, 'rgba(210, 80, 20, 0)');
    } else {
      // 暗赤のうねり
      grad.addColorStop(0, 'rgba(140, 35, 10, 0.45)');
      grad.addColorStop(1, 'rgba(140, 35, 10, 0)');
    }
    ctx.fillStyle = grad;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // 2. グラニュレーション（小さな粒状感を大量に重ねる）
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

  // 3. プロミネンス（明るく光るホットスポット）
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

  // 4. 黒点（暗い斑）— 数と濃さを上げて存在感を強める
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

// 太陽だけは不透明にして「光の塊」感を出す（地球/月は BODY_OPACITY のまま）
const sun = new THREE.Mesh(
  new THREE.SphereGeometry(SUN_RADIUS, 64, 64),
  new THREE.MeshBasicMaterial({
    map: createSunTexture(),
    transparent: false,
    depthWrite: true
  })
);
scene.add(sun);

// 太陽の自発光感：Sprite（境界レス・常時カメラ向き）で柔らかいハローを重ねる
// 球メッシュ製の旧コロナは縁が「枠」に見えたため、グラデーション Sprite に変更
function createSunHaloTexture() {
  const size = 512;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
  // 中心は太陽色、外側は完全透明。途中で色を変えて自然なグラデに
  g.addColorStop(0.00, 'rgba(255, 240, 180, 0.95)');
  g.addColorStop(0.12, 'rgba(255, 210, 130, 0.55)');
  g.addColorStop(0.30, 'rgba(255, 160,  70, 0.22)');
  g.addColorStop(0.55, 'rgba(255, 120,  40, 0.08)');
  g.addColorStop(1.00, 'rgba(255, 120,  40, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(cv);
}

function createSunRayTexture() {
  // 十字スパイク（一眼の回折スパイクを大きくして太陽光線に）
  const size = 1024;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  ctx.globalCompositeOperation = 'lighter';
  function drawSpike(angle, thickness, intensity) {
    ctx.save();
    ctx.translate(size/2, size/2);
    ctx.rotate(angle);
    const grad = ctx.createLinearGradient(-size/2, 0, size/2, 0);
    grad.addColorStop(0.00, 'rgba(255, 230, 150, 0)');
    grad.addColorStop(0.35, 'rgba(255, 230, 150, 0)');
    grad.addColorStop(0.49, `rgba(255, 240, 180, ${intensity * 0.5})`);
    grad.addColorStop(0.50, `rgba(255, 250, 220, ${intensity})`);
    grad.addColorStop(0.51, `rgba(255, 240, 180, ${intensity * 0.5})`);
    grad.addColorStop(0.65, 'rgba(255, 230, 150, 0)');
    grad.addColorStop(1.00, 'rgba(255, 230, 150, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(-size/2, -thickness/2, size, thickness);
    ctx.restore();
  }
  drawSpike(0,             8, 0.85);
  drawSpike(Math.PI / 2,   8, 0.85);
  drawSpike(Math.PI / 4,   5, 0.45);
  drawSpike(-Math.PI / 4,  5, 0.45);
  return new THREE.CanvasTexture(cv);
}

const SUN_HALO_TEX = createSunHaloTexture();
const SUN_RAY_TEX  = createSunRayTexture();

// 内側ハロー：太陽本体に近い、濃いめのオレンジ
const sunHaloInner = new THREE.Sprite(new THREE.SpriteMaterial({
  map: SUN_HALO_TEX,
  color: 0xffd070,
  transparent: true,
  opacity: 0.95,
  depthWrite: false,
  blending: THREE.AdditiveBlending
}));
sunHaloInner.scale.set(SUN_RADIUS * 5.5, SUN_RADIUS * 5.5, 1);
sun.add(sunHaloInner);

// 外側ハロー：薄く広く広がる
const sunHaloOuter = new THREE.Sprite(new THREE.SpriteMaterial({
  map: SUN_HALO_TEX,
  color: 0xffa040,
  transparent: true,
  opacity: 0.55,
  depthWrite: false,
  blending: THREE.AdditiveBlending
}));
sunHaloOuter.scale.set(SUN_RADIUS * 11, SUN_RADIUS * 11, 1);
sun.add(sunHaloOuter);

// 太陽光線（十字スパイク）：「光ってる」サインを大きく出す
const sunRays = new THREE.Sprite(new THREE.SpriteMaterial({
  map: SUN_RAY_TEX,
  color: 0xfff0c0,
  transparent: true,
  opacity: 0.85,
  depthWrite: false,
  blending: THREE.AdditiveBlending
}));
sunRays.scale.set(SUN_RADIUS * 16, SUN_RADIUS * 16, 1);
sun.add(sunRays);

// リムライト（縁が明るく光る効果）：球の縁ほど発光が強くなるシェーダー
const sunRim = new THREE.Mesh(
  new THREE.SphereGeometry(SUN_RADIUS * 1.003, 96, 96),
  new THREE.ShaderMaterial({
    uniforms: {
      glowColor: { value: new THREE.Color(0xffd870) }
    },
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

// 太陽（とコロナ・リム）だけBLOOM_LAYERに登録
sun.traverse((o) => o.layers.enable(BLOOM_LAYER));

// ============================================================
// 地球（楕円公転）
// ============================================================

// 階層構造：earthHolder（位置）→ earthTilt（自転軸傾き 23.44°）→ earth（自転）
// 自転軸の向きは慣性座標系で固定するため、earthHolder には回転を入れない
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
// 観測点マーカー（選択国の位置を地球表面に光らせる）
// ============================================================

function createObserverGlowTexture() {
  const size = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
  // 緑（星・月・太陽と混ざらない色）
  g.addColorStop(0,    'rgba(200, 255, 215, 1)');
  g.addColorStop(0.18, 'rgba(140, 255, 180, 0.85)');
  g.addColorStop(0.55, 'rgba( 60, 220, 130, 0.20)');
  g.addColorStop(1,    'rgba( 40, 200, 110, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(cv);
}

const OBSERVER_GLOW_TEX = createObserverGlowTexture();

const observerMarker = new THREE.Group();
const observerGlow = new THREE.Sprite(new THREE.SpriteMaterial({
  map: OBSERVER_GLOW_TEX,
  color: 0xb8ffd0,
  transparent: true,
  opacity: 0.95,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  depthTest: false   // 地球の裏側でも見えるように
}));
observerGlow.scale.set(0.36, 0.36, 1);
observerMarker.add(observerGlow);

const observerDot = new THREE.Mesh(
  new THREE.SphereGeometry(0.015, 16, 16),
  new THREE.MeshBasicMaterial({
    color: 0xd6ffe0,
    transparent: true,
    opacity: 1.0,
    depthTest: false,
    depthWrite: false
  })
);
observerDot.renderOrder = 999;
observerMarker.add(observerDot);

earth.add(observerMarker);

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

function updateObserverMarker() {
  const c = COUNTRIES[selectedCountryIdx];
  const pos = latLonToVec3(c.latDeg, c.lonDeg, EARTH_RADIUS * 1.015);
  observerMarker.position.copy(pos);
}
updateObserverMarker();

// ============================================================
// 月（地球に追従、5.145°傾斜した公転面）
// ============================================================

// 月軌道面の傾きを保持するノード（黄道面に対して 5.145° 傾ける）
const moonTilt = new THREE.Object3D();
moonTilt.rotation.z = MOON_INCLINATION_RAD;
scene.add(moonTilt);

// 月の公転回転ピボット（傾いた面上で y軸回転）
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

// 地球の楕円軌道線（太陽が楕円の中心。パラメトリック表現）
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

// 月の軌道線（傾斜面の中、円）
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
// テクスチャ非同期読み込み（成功すれば差し替え）
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
  if (earthSpec) { earth.material.roughnessMap = earthSpec; earth.material.metalnessMap = earthSpec; }
  earth.material.needsUpdate = true;

  if (moonColor) moon.material.map = moonColor;
  if (moonBump) { moon.material.bumpMap = moonBump; moon.material.bumpScale = 0.02; }
  moon.material.needsUpdate = true;
})();

// ============================================================
// 星空（プロシージャル：恒星 + 銀河の帯 + 星雲の靄）
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

// 明るい星向け：十字スパイク付きテクスチャ（一眼の回折スパイクの再現）
function createCrossStarTexture() {
  const size = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');

  // 中心のコア（ふんわり光る丸）
  const g = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size * 0.22);
  g.addColorStop(0,    'rgba(255, 255, 255, 1)');
  g.addColorStop(0.35, 'rgba(255, 255, 255, 0.55)');
  g.addColorStop(1,    'rgba(255, 255, 255, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);

  // 細いスパイク（4方向）
  ctx.globalCompositeOperation = 'lighter';
  function drawSpike(angle, thickness, length, intensity) {
    ctx.save();
    ctx.translate(size/2, size/2);
    ctx.rotate(angle);
    const grad = ctx.createLinearGradient(-size/2, 0, size/2, 0);
    const startCut = 0.5 - length * 0.5;
    const endCut   = 0.5 + length * 0.5;
    grad.addColorStop(0,           'rgba(255,255,255,0)');
    grad.addColorStop(startCut,    'rgba(255,255,255,0)');
    grad.addColorStop(0.49,        `rgba(255,255,255,${intensity * 0.45})`);
    grad.addColorStop(0.50,        `rgba(255,255,255,${intensity})`);
    grad.addColorStop(0.51,        `rgba(255,255,255,${intensity * 0.45})`);
    grad.addColorStop(endCut,      'rgba(255,255,255,0)');
    grad.addColorStop(1,           'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(-size/2, -thickness/2, size, thickness);
    ctx.restore();
  }
  // 主スパイク（縦・横、長く強く）
  drawSpike(0,             1.5, 0.95, 0.85);
  drawSpike(Math.PI / 2,   1.5, 0.95, 0.85);
  // 副スパイク（斜め、短く弱く）
  drawSpike(Math.PI / 4,   1.0, 0.55, 0.35);
  drawSpike(-Math.PI / 4,  1.0, 0.55, 0.35);

  return new THREE.CanvasTexture(cv);
}

// 帯方向の傾き（XZ平面に対して傾けた帯）
const STAR_BAND_TILT_X = THREE.MathUtils.degToRad(28);
const STAR_BAND_TILT_Z = THREE.MathUtils.degToRad(15);
const STAR_DISC_TEXTURE = createSoftDiscTexture();
const STAR_CROSS_TEXTURE = createCrossStarTexture();

// 半径方向にもばらつかせて奥行きを出す。
// rMin/rMax で球殻のレンジを指定できる（多層パララックスのため）
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
  if (tone < 0.55) {
    r0 = 1.0; g0 = 1.0; b0 = 1.0;
  } else if (tone < 0.8) {
    r0 = 0.78; g0 = 0.86; b0 = 1.0;
  } else {
    r0 = 1.0; g0 = 0.92; b0 = 0.75;
  }
  const brightness = 0.55 + Math.random() * 0.45;
  return { r: r0 * brightness, g: g0 * brightness, b: b0 * brightness };
}

function createStarLayer(count, sizePx, opacity, bandBias, rMin = 0.6, rMax = 1.0, useCross = false) {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const p = sampleStarPosition(bandBias, rMin, rMax);
    positions[i*3]   = p.x;
    positions[i*3+1] = p.y;
    positions[i*3+2] = p.z;
    const c = sampleStarColor();
    colors[i*3]   = c.r;
    colors[i*3+1] = c.g;
    colors[i*3+2] = c.b;
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  // sizeAttenuation: false にして固定ピクセルサイズで描画
  const mat = new THREE.PointsMaterial({
    size: sizePx,
    sizeAttenuation: false,
    transparent: true,
    opacity,
    depthWrite: false,
    vertexColors: true,
    blending: THREE.AdditiveBlending,
    map: useCross ? STAR_CROSS_TEXTURE : STAR_DISC_TEXTURE
  });
  return new THREE.Points(geom, mat);
}

// テクスチャなし・通常ブレンドのハードドット（極小星向け）
function createHardDotLayer(count, sizePx, opacity, bandBias, rMin = 0.6, rMax = 1.0) {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const p = sampleStarPosition(bandBias, rMin, rMax);
    positions[i*3]   = p.x;
    positions[i*3+1] = p.y;
    positions[i*3+2] = p.z;
    const c = sampleStarColor();
    colors[i*3]   = c.r;
    colors[i*3+1] = c.g;
    colors[i*3+2] = c.b;
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({
    size: sizePx,
    sizeAttenuation: false,
    transparent: true,
    opacity,
    depthWrite: false,
    vertexColors: true
  });
  return new THREE.Points(geom, mat);
}

// ---- 多層星空：遠景／中景／近景の3シェルでパララックスを強化 ----
// 視点を動かしたとき、近景は大きく流れ、中景はやや流れ、遠景はほぼ静止して見える

// 遠景：天球の主体。多数・小粒。
// 大粒星には十字スパイク付きテクスチャを使い、点像っぽさを回避
scene.add(createStarLayer(STAR_LARGE_COUNT,  6.0, 1.0,  0.45, 0.85, 1.00, true));  // 遠景大（クロス）
scene.add(createStarLayer(STAR_MEDIUM_COUNT, 4.0, 0.95, 0.40, 0.85, 1.00));        // 遠景中
scene.add(createStarLayer(STAR_SMALL_COUNT,  2.2, 0.80, 0.35, 0.85, 1.00));        // 遠景小
scene.add(createHardDotLayer(STAR_TINY_COUNT,  1.6, 0.9,  0.30, 0.85, 1.00));
scene.add(createHardDotLayer(STAR_MICRO_COUNT, 1.0, 0.65, 0.25, 0.85, 1.00));

// 中景：適度に視差。
scene.add(createStarLayer( 80, 5.0, 0.90, 0.42, 0.55, 0.78, true)); // 中景大（クロス）
scene.add(createStarLayer(220, 2.6, 0.85, 0.38, 0.55, 0.78));        // 中景中
scene.add(createHardDotLayer(500, 1.3, 0.75, 0.30, 0.55, 0.78));     // 中景小

// 近景：少数・粒大。視点移動で大きく流れる
scene.add(createStarLayer( 35, 7.5, 0.95, 0.50, 0.36, 0.50, true)); // 近景大（クロス）
scene.add(createStarLayer(110, 3.4, 0.85, 0.42, 0.36, 0.50));        // 近景中
scene.add(createHardDotLayer(220, 1.5, 0.70, 0.32, 0.36, 0.50));     // 近景小

// 大きな主役の星（10個ほど、ランダムに）— 十字スパイクで存在感を出す
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
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      blending: THREE.AdditiveBlending
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

// 銀河の帯らしさを強める淡い靄（青紫の星雲）
function createNebulaHaze() {
  const group = new THREE.Group();
  const colors = [0x3a4a8a, 0x6a3a8a, 0x2a5a8a, 0x4a3a7a, 0x5a4a9a];
  const tex = createSoftDiscTexture();
  const bandTiltX = THREE.MathUtils.degToRad(28);
  const bandTiltZ = THREE.MathUtils.degToRad(15);
  for (let i = 0; i < 14; i++) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex,
      color: colors[i % colors.length],
      transparent: true,
      opacity: 0.07 + Math.random() * 0.07,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    }));
    // 帯方向に集中させる
    const theta = Math.random() * Math.PI * 2;
    const r = STAR_FIELD_RADIUS * 0.72;
    let x = r * Math.cos(theta);
    let y = (Math.random() - 0.5) * STAR_FIELD_RADIUS * 0.15;
    let z = r * Math.sin(theta);
    // 同じ傾きで回す
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
// 月相プレビュー小窓
// ============================================================

const moonMiniCanvas = document.getElementById('moon-mini');
const moonMiniCtx = moonMiniCanvas ? moonMiniCanvas.getContext('2d') : null;

// HiDPI 対応：実ピクセル数を上げて鮮鋭化
function setupMiniCanvas() {
  if (!moonMiniCanvas) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssW = moonMiniCanvas.clientWidth || 220;
  const cssH = moonMiniCanvas.clientHeight || 220;
  moonMiniCanvas.width  = Math.round(cssW * dpr);
  moonMiniCanvas.height = Math.round(cssH * dpr);
  moonMiniCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// 太陽-地球-月の位置から、選択国の観測者が見る月相パラメータを求める
const _v_obsWorld   = new THREE.Vector3();
const _v_earthWorld = new THREE.Vector3();
const _v_moonWorld  = new THREE.Vector3();
const _v_canvasZ    = new THREE.Vector3();
const _v_canvasY    = new THREE.Vector3();
const _v_canvasX    = new THREE.Vector3();
const _v_upDir      = new THREE.Vector3();
const _v_obsToMoon  = new THREE.Vector3();
const _v_obsToSun   = new THREE.Vector3();
const _v_moonToSun  = new THREE.Vector3();
const _v_moonToEar  = new THREE.Vector3();
const _v_worldUp    = new THREE.Vector3(0, 1, 0);
const _v_sunOrigin  = new THREE.Vector3(0, 0, 0);
const _v_obsLocal   = new THREE.Vector3();

function computeMoonView() {
  const c = COUNTRIES[selectedCountryIdx];

  // 観測者の世界座標：地球ローカル位置を earth.matrixWorld で変換
  earth.updateMatrixWorld();
  const lat = THREE.MathUtils.degToRad(c.latDeg);
  const lon = THREE.MathUtils.degToRad(c.lonDeg);
  _v_obsLocal.set(
    EARTH_RADIUS * Math.cos(lat) * Math.cos(lon),
    EARTH_RADIUS * Math.sin(lat),
    -EARTH_RADIUS * Math.cos(lat) * Math.sin(lon)
  );
  _v_obsWorld.copy(_v_obsLocal).applyMatrix4(earth.matrixWorld);

  earth.getWorldPosition(_v_earthWorld);
  moon.getWorldPosition(_v_moonWorld);

  // 観測者の天頂方向（地球中心→観測点）
  _v_upDir.subVectors(_v_obsWorld, _v_earthWorld).normalize();

  // 観測者→月／観測者→太陽
  _v_obsToMoon.subVectors(_v_moonWorld, _v_obsWorld).normalize();
  _v_obsToSun.subVectors(_v_sunOrigin, _v_obsWorld).normalize();

  // 月相角（月における 太陽-地球 のなす角）
  _v_moonToSun.subVectors(_v_sunOrigin, _v_moonWorld).normalize();
  _v_moonToEar.subVectors(_v_earthWorld, _v_moonWorld).normalize();
  const cosPhase = THREE.MathUtils.clamp(_v_moonToSun.dot(_v_moonToEar), -1, 1);
  const phaseAngle = Math.acos(cosPhase);

  // 観測者ローカルキャンバス軸
  _v_canvasZ.copy(_v_obsToMoon);
  _v_canvasY.copy(_v_upDir).addScaledVector(_v_canvasZ, -_v_upDir.dot(_v_canvasZ));
  if (_v_canvasY.lengthSq() < 1e-8) {
    _v_canvasY.copy(_v_worldUp).addScaledVector(_v_canvasZ, -_v_worldUp.dot(_v_canvasZ));
  }
  _v_canvasY.normalize();
  _v_canvasX.crossVectors(_v_canvasY, _v_canvasZ).normalize();

  // 太陽方向のキャンバス平面成分
  const sunX = _v_obsToSun.dot(_v_canvasX);
  const sunY = _v_obsToSun.dot(_v_canvasY);
  const sunAngleMath = Math.atan2(sunY, sunX);

  // 月の地球向き面はほぼ固定（潮汐ロック）だが、傾きの僅差を反映：
  // ここでは小窓の見た目に集中するため、輝度のみ phaseAngle に依存
  return { phaseAngle, sunAngleMath };
}

// 小窓の月：暗い円盤＋日照部の二色描画。日照側が +x になるよう回転して描く
function drawMoonMini() {
  if (!moonMiniCtx) return;
  const cssW = moonMiniCanvas.clientWidth || 220;
  const cssH = moonMiniCanvas.clientHeight || 220;
  const ctx = moonMiniCtx;

  ctx.clearRect(0, 0, cssW, cssH);

  const { phaseAngle, sunAngleMath } = computeMoonView();

  ctx.save();
  ctx.translate(cssW / 2, cssH / 2);
  // 太陽方向を画面右に。pixel座標系は y下向きなので、math角を符号反転
  ctx.rotate(-sunAngleMath);

  const r = Math.min(cssW, cssH) * 0.34;

  // 暗い側の月（うっすら見える dark side）
  ctx.fillStyle = '#1a1c2a';
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();

  const cosA = Math.cos(phaseAngle);

  // 日照部
  ctx.fillStyle = '#f0ecd6';
  if (phaseAngle < 0.005) {
    // 満月
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
  } else if (phaseAngle > Math.PI - 0.005) {
    // 新月：暗い円盤のみ
  } else {
    ctx.beginPath();
    // 右半円（top→right→bottom、canvas pixelでは -π/2 → +π/2、anticlockwise=false）
    ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, false);
    // 終端線（楕円）で bottom→top に戻す
    // 凸満（cosA>0）：左を通る＝canvas anticlockwise=true
    // 凸欠（cosA<0）：右を通る＝anticlockwise=false
    const ellSemiMinor = r * Math.abs(cosA);
    ctx.ellipse(0, 0, ellSemiMinor, r, 0, Math.PI / 2, -Math.PI / 2, cosA > 0);
    ctx.fill();
  }

  // ハイライト（中央付近のほのかな反射）
  if (phaseAngle < Math.PI * 0.95) {
    const litFrac = (1 + Math.cos(phaseAngle)) / 2;
    const hlR = r * 0.55;
    const hlX = r * 0.18 * (cosA);
    const hl = ctx.createRadialGradient(hlX, -r * 0.08, 0, hlX, -r * 0.08, hlR);
    hl.addColorStop(0,   `rgba(255, 250, 230, ${0.10 * litFrac})`);
    hl.addColorStop(1,   'rgba(255, 250, 230, 0)');
    ctx.fillStyle = hl;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

// ============================================================
// 国旗UI（普段は選択国1枚のみ。クリックでメニュー展開→他国を選択）
// ============================================================

const FLAG_URL = (code) => `https://flagcdn.com/${code}.svg`;

function setupCountryFlags() {
  const currentBtn = document.getElementById('current-flag');
  const menu = document.getElementById('flag-menu');
  if (!currentBtn || !menu) return;
  const currentImg = currentBtn.querySelector('img');

  function refreshCurrent() {
    const c = COUNTRIES[selectedCountryIdx];
    currentImg.src = FLAG_URL(c.code);
    currentImg.alt = c.name;
    currentBtn.setAttribute('aria-label', `観測国: ${c.name}（クリックで切替）`);
  }

  function buildMenu() {
    menu.innerHTML = '';
    COUNTRIES.forEach((c, idx) => {
      if (idx === selectedCountryIdx) return;  // 現在選択中はメニューから除外
      const btn = document.createElement('button');
      btn.className = 'flag-btn flag-option';
      btn.setAttribute('aria-label', c.name);
      btn.dataset.idx = String(idx);
      const img = document.createElement('img');
      img.src = FLAG_URL(c.code);
      img.alt = '';
      img.loading = 'eager';
      img.decoding = 'async';
      btn.appendChild(img);
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        pickCountry(idx);
      });
      menu.appendChild(btn);
    });
  }

  function openMenu()  { menu.classList.remove('hidden'); }
  function closeMenu() { menu.classList.add('hidden'); }
  const isOpen = () => !menu.classList.contains('hidden');

  function pickCountry(idx) {
    selectedCountryIdx = idx;
    refreshCurrent();
    buildMenu();
    closeMenu();
    updateObserverMarker();
    drawMoonMini();
  }

  currentBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (isOpen()) closeMenu(); else openMenu();
  });

  // メニュー外をクリックで閉じる
  document.addEventListener('click', (e) => {
    if (!isOpen()) return;
    if (currentBtn.contains(e.target)) return;
    if (menu.contains(e.target)) return;
    closeMenu();
  });
  document.addEventListener('touchstart', (e) => {
    if (!isOpen()) return;
    const t = e.target;
    if (currentBtn.contains(t)) return;
    if (menu.contains(t)) return;
    closeMenu();
  }, { passive: true });

  refreshCurrent();
  buildMenu();
  closeMenu();
}

// パネル内のクリックがキャンバス側の停止/再生に伝わらないように
const observerPanelEl = document.getElementById('observer-panel');
if (observerPanelEl) {
  ['mousedown', 'mouseup', 'click', 'touchstart', 'touchend', 'pointerdown', 'pointerup'].forEach((ev) => {
    observerPanelEl.addEventListener(ev, (e) => e.stopPropagation());
  });
}

setupCountryFlags();
setupMiniCanvas();

// ============================================================
// TODAY ボタン：今日の地球公転位置 + 月相に合わせて一時停止
// ============================================================

// 既知の新月 epoch（2000-01-06 18:14 UTC）と朔望周期から月相を算出
const NEW_MOON_EPOCH_MS  = Date.UTC(2000, 0, 6, 18, 14, 0);
const SYNODIC_MONTH_DAYS = 29.530588853;

function moonPhaseAt(dateMs) {
  const days = (dateMs - NEW_MOON_EPOCH_MS) / 86400000;
  let p = (days / SYNODIC_MONTH_DAYS) % 1;
  if (p < 0) p += 1;
  return p; // 0=新月、0.25=上弦、0.5=満月、0.75=下弦
}

// アプリ内の moonAngle と月相の対応：
//   moonAngle = 0  → 月は地球の +X 側（太陽と反対）→ 満月（phase=0.5）
//   moonAngle = π  → 新月（phase=0）
// → moonAngle = (phase - 0.5) * 2π
function phaseToMoonAngle(phase) {
  return (phase - 0.5) * Math.PI * 2;
}

function earthAngleForDate(date) {
  const m = date.getMonth();             // 0..11
  const d = date.getDate();              // 1..31
  const daysInMonth = new Date(date.getFullYear(), m + 1, 0).getDate();
  const monthFrac = (d - 1) / daysInMonth;
  return ((m + monthFrac) / 12) * Math.PI * 2;
}

function setSceneToToday() {
  const now = new Date();
  earthAngle = earthAngleForDate(now);
  moonAngle  = phaseToMoonAngle(moonPhaseAt(now.getTime()));
  // 自転位相は任意：見やすさのため0に揃える
  earthSpin = 0;
  sunSpin   = 0;

  // 強制的に一時停止＋月数チップを今の値で表示
  isPlaying = false;
  const m = ((Math.floor(earthAngle / (Math.PI * 2 / 12)) % 12) + 12) % 12 + 1;
  monthNumberEl.textContent = String(m);
  if (monthNameEl) monthNameEl.textContent = MONTH_NAMES[m - 1];
  monthChip.classList.remove('hidden');

  // 画面中央に「6/1」のような日付を一瞬表示
  showTodayDateFlash(now);
}

const todayDateEl = document.getElementById('today-date');
let _todayDateTimer = null;

function showTodayDateFlash(date) {
  if (!todayDateEl) return;
  todayDateEl.textContent = `${date.getMonth() + 1}/${date.getDate()}`;
  todayDateEl.classList.remove('hidden');
  // 次フレームで .show を付けてフェードイン
  requestAnimationFrame(() => {
    todayDateEl.classList.add('show');
  });
  clearTimeout(_todayDateTimer);
  _todayDateTimer = setTimeout(() => {
    todayDateEl.classList.remove('show');
    // フェードアウトが終わってから display:none
    setTimeout(() => todayDateEl.classList.add('hidden'), 600);
  }, 2200);
}

const todayBtn = document.getElementById('today-btn');
if (todayBtn) {
  todayBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    setSceneToToday();
    todayBtn.classList.add('is-active');
    // 再生ボタンが押されたら is-active を解除
  });
}

// 再生再開や任意操作で TODAY 強調を解除（軽い視覚フィードバック）
function clearTodayHighlight() {
  if (todayBtn) todayBtn.classList.remove('is-active');
}

// ============================================================
// 状態
// ============================================================

let isPlaying = true;
let earthAngle = 0;
let moonAngle = 0;
let earthSpin = 0;
let sunSpin = 0;

let focusTarget = sun;
const focusables = [sun, earth, moon];
const raycaster = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
const _tmpVec = new THREE.Vector3();

function updateFocus() {
  if (!focusTarget) return;
  focusTarget.getWorldPosition(_tmpVec);
  controls.target.copy(_tmpVec);
}

// ============================================================
// 楕円軌道で地球位置を更新（太陽=焦点）
// ============================================================

function updateEarthPosition() {
  const a = SUN_EARTH_DIST;
  const b = a * Math.sqrt(1 - EARTH_ECCENTRICITY * EARTH_ECCENTRICITY);
  earthHolder.position.x = a * Math.cos(earthAngle);
  earthHolder.position.y = 0;
  earthHolder.position.z = -b * Math.sin(earthAngle);
}

// 月の系（moonTilt）を地球に追従させる
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
// アニメーション
// ============================================================

const clock = new THREE.Clock();

function animate() {
  const dt = clock.getDelta();

  if (isPlaying) {
    earthAngle += (Math.PI * 2 / EARTH_ORBIT_PERIOD) * dt;
    moonAngle  += (Math.PI * 2 / MOON_ORBIT_PERIOD)  * dt;
    earthSpin  += (Math.PI * 2 / EARTH_SPIN_PERIOD)  * dt;
    sunSpin    += (Math.PI * 2 / SUN_SPIN_PERIOD)    * dt;
  }

  updateEarthPosition();
  earth.rotation.y = earthSpin;
  sun.rotation.y = sunSpin;
  moonOrbit.rotation.y = moonAngle;
  // 月の自転は moonOrbit 自体の回転で潮汐ロックが自動達成されるため、moon自身は加算しない
  moon.rotation.y = 0;

  syncMoonSystemToEarth();
  updateFocus();
  controls.update();
  renderSelectiveBloom();
  drawMoonMini();
  requestAnimationFrame(animate);
}

function renderSelectiveBloom() {
  // 1段目：太陽以外を一時的に非表示にしてブルーム対象だけ描画
  const savedBg = scene.background;
  scene.background = null;
  scene.traverse(hideNonBloomed);
  bloomComposer.render();
  scene.traverse(restoreVisibility);
  scene.background = savedBg;
  // 2段目：通常描画＋ブルームを加算合成
  finalComposer.render();
}

animate();

// ============================================================
// クリック / タップで停止・再生トグル、ダブルクリックでフォーカス
// ============================================================

let pointerDown = null;
let lastClickTime = 0;
let pendingSingleClick = null;
const DOUBLE_CLICK_MS = 280;

function onPointerDown(e) {
  const p = pointerFromEvent(e);
  pointerDown = { x: p.x, y: p.y, t: performance.now() };
}

function onPointerUp(e) {
  if (!pointerDown) return;
  const p = pointerFromEvent(e);
  const dx = p.x - pointerDown.x;
  const dy = p.y - pointerDown.y;
  const dist = Math.hypot(dx, dy);
  const elapsed = performance.now() - pointerDown.t;
  pointerDown = null;
  if (dist > CLICK_THRESHOLD_PX || elapsed >= CLICK_MAX_DURATION_MS) return;

  const now = performance.now();
  if (now - lastClickTime < DOUBLE_CLICK_MS) {
    if (pendingSingleClick) {
      clearTimeout(pendingSingleClick);
      pendingSingleClick = null;
    }
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
  _ndc.x = (p.x / window.innerWidth) * 2 - 1;
  _ndc.y = -(p.y / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(_ndc, camera);
  const hits = raycaster.intersectObjects(focusables, false);
  if (hits.length > 0) {
    focusTarget = hits[0].object;
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

canvas.addEventListener('mousedown', onPointerDown);
canvas.addEventListener('mouseup', onPointerUp);
canvas.addEventListener('touchstart', onPointerDown, { passive: true });
canvas.addEventListener('touchend', onPointerUp);

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
  setupMiniCanvas();
});
