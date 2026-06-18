import * as THREE from 'three';
import GUI from 'lil-gui';
import './style.css';
import vertexShader from './shaders/vertex.glsl?raw';
import fragmentShader from './shaders/fragment.glsl?raw';

// ============================================================
//  src/assets/ に置いた写真を自動で読み込む
//  （jpg / jpeg / png / webp を入れるだけでカードが増える）
// ============================================================
const assetModules = import.meta.glob(
  './assets/*.{jpg,jpeg,png,JPG,JPEG,PNG,webp,WEBP}',
  { eager: true, query: '?url', import: 'default' }
);
const assetEntries = Object.entries(assetModules)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([path, url]) => ({
    url,
    label: path.split('/').pop().replace(/\.[^.]+$/, ''),
  }));

// テクスチャの作業解像度（パーティクルの密度に直結）
const IMG_W = 480;
const IMG_H = 320; // カードの 3:2

// ============================================================
//  画像を 3:2 に cover フィットさせた ImageData を作る
// ============================================================
function fitImageToCanvas(img, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  // cover: 短辺を合わせて中央クロップ
  const scale = Math.max(width / img.width, height / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  ctx.drawImage(img, (width - dw) / 2, (height - dh) / 2, dw, dh);

  return { canvas, ctx, imageData: ctx.getImageData(0, 0, width, height) };
}

// ============================================================
//  写真 → パーティクル（位置 + 色）
// ============================================================
function sampleFromPhoto(img, step = 3) {
  const { canvas, imageData } = fitImageToCanvas(img, IMG_W, IMG_H);
  const data = imageData.data;

  const positions = [];
  const colors = [];
  // step: 小さいほど高精細・高負荷
  for (let y = 0; y < IMG_H; y += step) {
    for (let x = 0; x < IMG_W; x += step) {
      const idx = (y * IMG_W + x) * 4;
      if (data[idx + 3] < 16) continue; // 透明部分はスキップ
      positions.push(x - IMG_W / 2, y - IMG_H / 2);
      colors.push(data[idx] / 255, data[idx + 1] / 255, data[idx + 2] / 255);
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return { positions, colors, texture };
}

// ============================================================
//  テキスト → パーティクル（位置 + 単色）
// ============================================================
function sampleFromText(text, rgb, step = 3) {
  const canvas = document.createElement('canvas');
  canvas.width = IMG_W;
  canvas.height = IMG_H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, IMG_W, IMG_H);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  let fontSize = Math.floor(IMG_H * 0.42);
  const maxW = IMG_W * 0.85;
  for (let i = 0; i < 12; i++) {
    ctx.font = `bold ${fontSize}px "Helvetica Neue", Arial, sans-serif`;
    if (ctx.measureText(text).width <= maxW) break;
    fontSize *= 0.92;
  }
  ctx.font = `bold ${Math.floor(fontSize)}px "Helvetica Neue", Arial, sans-serif`;
  ctx.fillText(text, IMG_W / 2, IMG_H / 2);

  const data = ctx.getImageData(0, 0, IMG_W, IMG_H).data;
  const positions = [];
  const colors = [];
  for (let y = 0; y < IMG_H; y += step) {
    for (let x = 0; x < IMG_W; x += step) {
      if (data[(y * IMG_W + x) * 4 + 3] > 128) {
        positions.push(x - IMG_W / 2, y - IMG_H / 2);
        colors.push(rgb[0], rgb[1], rgb[2]);
      }
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return { positions, colors, texture };
}

// ============================================================
//  ジオメトリに quad サイズ（粒の大きさ）を書き込む
// ============================================================
function writeQuadSize(geometry, size) {
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    -size, -size, 0,   size, -size, 0,   size, size, 0,
    -size, -size, 0,   size,  size, 0,  -size, size, 0,
  ]), 3));
}

// ============================================================
//  サンプル結果（位置・色・テクスチャ）をジオメトリへ流し込む
//  密度変更時にも呼び出して作り直す。
// ============================================================
function writeSampleData(geometry, uniforms, { positions, colors, texture }) {
  const particleCount = positions.length / 2;

  const offsets = new Float32Array(particleCount * 2);
  for (let i = 0; i < particleCount; i++) {
    offsets[i * 2]     = positions[i * 2];
    offsets[i * 2 + 1] = -positions[i * 2 + 1]; // 画像 Y を反転
  }
  geometry.setAttribute('offset', new THREE.InstancedBufferAttribute(offsets, 2));
  geometry.setAttribute('instanceColor',
    new THREE.InstancedBufferAttribute(new Float32Array(colors), 3));

  const randomVals = new Float32Array(particleCount * 4);
  for (let i = 0; i < particleCount * 4; i++) randomVals[i] = Math.random();
  geometry.setAttribute('randomValues', new THREE.InstancedBufferAttribute(randomVals, 4));

  geometry.instanceCount = particleCount;
  if (uniforms) uniforms.textTexture.value = texture;
}

// ============================================================
//  サンプル結果からカードの WebGL シーンを構築
// ============================================================
function buildCard(sample, params) {
  const canvas = document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(
    -IMG_W / 2, IMG_W / 2, IMG_H / 2, -IMG_H / 2, 0.1, 1000
  );
  camera.position.z = 10;

  const geometry = new THREE.InstancedBufferGeometry();
  writeQuadSize(geometry, params.size);
  geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([
    0, 0,  1, 0,  1, 1,
    0, 0,  1, 1,  0, 1,
  ]), 2));

  const uniforms = {
    time:            { value: Math.random() * 1000 },
    animationValue0: { value: 1.0 }, // 1.0 = 集合（待機状態は写真/文字が見える）
    animationValue1: { value: 0.0 }, // 0→1→0 でホバー演出
    offsetCoef:      { value: 1.0 },
    fromMin:         { value: new THREE.Vector3() },
    fromMax:         { value: new THREE.Vector3() },
    imageResolution: { value: new THREE.Vector2(IMG_W, IMG_H) },
    waveAmp:         { value: new THREE.Vector3() },
    fromScale:       { value: params.fromScale },
    effectScale:     { value: 1.0 },
    imagePixelRatio: { value: 1.0 },
    seed:            { value: Math.random() * 100 },
    textTexture:     { value: null },
    opacity:         { value: params.opacity },
    burstValue:      { value: 0.0 },          // クリックで 0→1→0
    burstAmp:        { value: params.burstAmp }, // 飛距離
  };

  writeSampleData(geometry, uniforms, sample);

  const material = new THREE.RawShaderMaterial({
    vertexShader, fragmentShader, uniforms,
    transparent: true, depthTest: false,
    blending: THREE.NormalBlending,
  });
  scene.add(new THREE.Mesh(geometry, material));

  return { canvas, renderer, scene, camera, geometry, uniforms, material };
}

const BLEND_MODES = {
  normal:   THREE.NormalBlending,   // 写真がきれいに密で埋まる
  additive: THREE.AdditiveBlending, // 散らばり時のキラキラ・発光感
};

// ============================================================
//  uniform / 粒サイズへ GUI パラメータを反映
// ============================================================
function applyParams(built, p) {
  built.uniforms.fromMin.value.set(-p.scatterXY, -p.scatterXY * 0.8, -p.scatterZ);
  built.uniforms.fromMax.value.set(p.scatterXY, p.scatterXY * 0.8, p.scatterZ);
  built.uniforms.waveAmp.value.set(0.1 * p.wave, 0.08 * p.wave, 0.05 * p.wave);
  built.uniforms.fromScale.value = p.fromScale;
  built.uniforms.opacity.value = p.opacity;
  built.uniforms.burstAmp.value = p.burstAmp;
}

// イージング
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeInOutCubic = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

// パルス: 0→1→0。ピークを前半(out)に寄せ、後半は素早く集合して静止。
// → 散らばり（黒い瞬間）を短く通過し、早めに元へ戻る。
function pulse(p, out = 0.3, back = 0.4) {
  if (p < out) return easeOutCubic(p / out);
  if (p < out + back) return 1 - easeInOutCubic((p - out) / back);
  return 0; // 残りは集合で静止
}

// ============================================================
//  カードコンポーネント（DOM + ホバー演出 + 更新）
//  写真は非同期ロードなので、読み込み後にシーンを差し込む。
// ============================================================
function createCard({ kind, src, word, label, color, glow }, params) {
  const el = document.createElement('article');
  el.className = 'card';
  el.style.setProperty('--glow', glow);
  el.insertAdjacentHTML('beforeend', `
    <div class="card-meta">
      <div class="kicker">Hover me</div>
      <div class="label">${label}</div>
    </div>
  `);

  let scene = null;       // buildCard の戻り値（ロード完了後にセット）
  let sampler = null;     // (step) => {positions, colors, texture}
  let playing = false;
  let progress = 0;
  let bursting = false;   // クリックの放射状バースト
  let burstProgress = 0;

  function attach(makeSampler) {
    sampler = makeSampler;
    scene = buildCard(sampler(params.step), params);
    applyParams(scene, params);
    applyBlend();
    el.insertBefore(scene.canvas, el.firstChild);
    resize();
  }

  if (kind === 'text') {
    attach((step) => sampleFromText(word, color, step));
  } else {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => attach((step) => sampleFromPhoto(img, step));
    img.onerror = () =>
      attach((step) => sampleFromText(label.toUpperCase(), [0.7, 0.8, 1.0], step));
    img.src = src;
  }

  el.addEventListener('mouseenter', () => { playing = true; progress = 0; });
  el.addEventListener('click', () => { bursting = true; burstProgress = 0; });

  function resize() {
    if (!scene) return;
    const w = el.clientWidth;
    const h = el.clientHeight;
    if (w === 0 || h === 0) return;
    scene.renderer.setSize(w, h, false);
  }

  // GUI: uniform 系の即時反映
  function apply() {
    if (scene) applyParams(scene, params);
  }
  // GUI: 粒サイズ変更（ジオメトリ再構築）
  function applySize() {
    if (scene) writeQuadSize(scene.geometry, params.size);
  }
  // GUI: 密度（step）変更 → サンプリングし直し
  function regen() {
    if (scene && sampler) writeSampleData(scene.geometry, scene.uniforms, sampler(params.step));
  }
  // GUI: 合成モード切替
  function applyBlend() {
    if (!scene) return;
    scene.material.blending = BLEND_MODES[params.blend] ?? THREE.NormalBlending;
    scene.material.needsUpdate = true;
  }
  // GUI: ホバー演出を手動再生
  function replay() { playing = true; progress = 0; }
  // GUI: クリックバーストを手動再生
  function burst() { bursting = true; burstProgress = 0; }

  function update(dt) {
    if (!scene) return;
    scene.uniforms.time.value += dt * 1000;

    if (playing) {
      progress += dt / params.duration;
      if (progress >= 1) { progress = 1; playing = false; }
      // pulse: 散って“早めに”集合（後半は静止）。peak で最大量を調整
      scene.uniforms.animationValue1.value =
        playing ? pulse(progress) * params.peak : 0;
    }

    if (bursting) {
      burstProgress += dt / params.burstDuration;
      if (burstProgress >= 1) { burstProgress = 1; bursting = false; }
      // 速く飛び出し → 早めに集合して静止（黒い瞬間を短く）
      scene.uniforms.burstValue.value =
        bursting ? pulse(burstProgress, 0.22, 0.4) : 0;
    }

    scene.renderer.render(scene.scene, scene.camera);
  }

  return { el, update, resize, apply, applySize, regen, replay, applyBlend, burst };
}

// ============================================================
//  カード設定（src/assets の写真からカードを生成）
// ============================================================
const GLOWS = [
  'rgba(120, 170, 255, 0.5)', 'rgba(255, 120, 180, 0.5)',
  'rgba(90, 230, 170, 0.5)',  'rgba(255, 190, 90, 0.5)',
  'rgba(180, 140, 255, 0.5)', 'rgba(110, 210, 255, 0.5)',
];

const configs = assetEntries.map((e, i) => ({
  kind: 'photo', src: e.url, label: e.label, glow: GLOWS[i % GLOWS.length],
}));

// ============================================================
//  全カード共有パラメータ（lil-gui で調整）
// ============================================================
const params = {
  duration: 1.6,      // ホバー演出の長さ（秒）
  peak: 1,          // 散らばりの最大量（1=完全に散る/写真が消える, 小さいほど写真が残る）
  burstAmp: 1.3,      // クリック時の四方への飛距離
  burstDuration: 1.3, // クリック演出の長さ（秒）
  blend: 'normal',    // 合成モード（normal=写真がきれい / additive=発光）
  size: 2.0,       // 粒の大きさ
  step: 3,         // サンプリング間隔（小さい=高精細・高負荷）
  scatterXY: 0.35, // 散らばり範囲（XY）
  scatterZ: 0.1,   // 散らばり範囲（奥行き Z）
  wave: 1.0,       // 浮遊の波の強さ
  fromScale: 0.7,  // 散らばり時の粒スケール
  opacity: 1.0,    // 不透明度
};

// ============================================================
//  グリッド構築
// ============================================================
const grid = document.getElementById('cardGrid');
const cards = configs.map((cfg, i) => {
  const card = createCard(cfg, params);
  card.el.insertAdjacentHTML('beforeend',
    `<div class="card-index">0${i + 1}</div>`);
  grid.appendChild(card.el);
  return card;
});

requestAnimationFrame(() => cards.forEach((c) => c.resize()));
window.addEventListener('resize', () => cards.forEach((c) => c.resize()));

// ============================================================
//  lil-gui
// ============================================================
const gui = new GUI({ title: 'Particle Cards' });
const apply     = () => cards.forEach((c) => c.apply());
const applySize = () => cards.forEach((c) => c.applySize());
const applyBlend = () => cards.forEach((c) => c.applyBlend());
const regen     = () => cards.forEach((c) => c.regen());
const replayAll = () => cards.forEach((c) => c.replay());
const burstAll  = () => cards.forEach((c) => c.burst());

const fAnim = gui.addFolder('ホバー演出');
fAnim.add(params, 'duration', 0.4, 4.0, 0.1).name('長さ(秒)');
fAnim.add(params, 'peak', 0.1, 1.0, 0.05).name('散らばり量');
fAnim.add({ replay: replayAll }, 'replay').name('▶ 再生（全カード）');

const fBurst = gui.addFolder('クリック放射');
fBurst.add(params, 'burstAmp', 0.3, 3.0, 0.1).name('飛距離').onChange(apply);
fBurst.add(params, 'burstDuration', 0.4, 3.0, 0.1).name('長さ(秒)');
fBurst.add({ burst: burstAll }, 'burst').name('💥 飛び散る（全カード）');

const fLook = gui.addFolder('見た目');
fLook.add(params, 'blend', { '通常(写真がきれい)': 'normal', '加算(発光)': 'additive' })
  .name('合成モード').onChange(applyBlend);
fLook.add(params, 'size', 0.5, 6.0, 0.1).name('粒の大きさ').onChange(applySize);
fLook.add(params, 'step', 1, 8, 1).name('粒の間隔(密度)').onFinishChange(regen);
fLook.add(params, 'opacity', 0.1, 1.0, 0.05).name('不透明度').onChange(apply);

const fScatter = gui.addFolder('散らばり');
fScatter.add(params, 'scatterXY', 0.0, 1.0, 0.01).name('範囲 XY').onChange(apply);
fScatter.add(params, 'scatterZ', 0.0, 0.6, 0.01).name('範囲 Z(奥行)').onChange(apply);
fScatter.add(params, 'wave', 0.0, 3.0, 0.05).name('浮遊の強さ').onChange(apply);
fScatter.add(params, 'fromScale', 0.0, 2.0, 0.05).name('散り粒スケール').onChange(apply);

const clock = new THREE.Clock();
function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.05);
  cards.forEach((c) => c.update(dt));
}
tick();
