import * as THREE from 'three';
import GUI from 'lil-gui';
import './style.css';
import vertexShader from './shaders/vertex.glsl?raw';
import fragmentShader from './shaders/fragment.glsl?raw';

// ============================================================
//  テキストテクスチャ生成
// ============================================================
function createTextTexture(text, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  ctx.clearRect(0, 0, width, height);

  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${Math.floor(height * 0.32)}px "Helvetica Neue", Arial, sans-serif`;
  ctx.fillText(text, width / 2, height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;

  const imageData = ctx.getImageData(0, 0, width, height);
  const positions = [];
  const step = 2;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const alpha = imageData.data[(y * width + x) * 4 + 3];
      if (alpha > 128) {
        positions.push(x - width / 2, y - height / 2);
      }
    }
  }
  return { texture, positions, width, height };
}

// ============================================================
//  シーン・カメラ・レンダラー
// ============================================================
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x0a0a0f, 1);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();

const camera = new THREE.OrthographicCamera(
  -window.innerWidth / 2, window.innerWidth / 2,
  window.innerHeight / 2, -window.innerHeight / 2,
  0.1, 1000
);
camera.position.z = 10;

const imgW = 1024;
const imgH = 512;
const { texture: textTexture, positions: textPositions } = createTextTexture('HELLO', imgW, imgH);

const particleCount = textPositions.length / 2;
console.log(`パーティクル数: ${particleCount}`);

// ============================================================
//  InstancedBufferGeometry
// ============================================================
const size = 3.0;
const baseGeometry = new THREE.InstancedBufferGeometry();

const posArray = new Float32Array([
  -size, -size, 0,
   size, -size, 0,
   size,  size, 0,
  -size, -size, 0,
   size,  size, 0,
  -size,  size, 0,
]);
baseGeometry.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
console.log(posArray);
const uvArray = new Float32Array([
  0, 0,  1, 0,  1, 1,
  0, 0,  1, 1,  0, 1,
]);
baseGeometry.setAttribute('uv', new THREE.BufferAttribute(uvArray, 2));

const offsets = new Float32Array(particleCount * 2);
for (let i = 0; i < particleCount; i++) {
  offsets[i * 2]     = textPositions[i * 2];
  offsets[i * 2 + 1] = -textPositions[i * 2 + 1];
}
baseGeometry.setAttribute('offset', new THREE.InstancedBufferAttribute(offsets, 2));

const randomVals = new Float32Array(particleCount * 4);
for (let i = 0; i < particleCount * 4; i++) {
  randomVals[i] = Math.random();
}
baseGeometry.setAttribute('randomValues', new THREE.InstancedBufferAttribute(randomVals, 4));
console.log(baseGeometry)
// ============================================================
//  シェーダーマテリアル
// ============================================================
const uniforms = {
  time:            { value: 0 },
  animationValue0: { value: 0.0 },
  animationValue1: { value: 0.0 },
  offsetCoef:      { value: 1.0 },
  fromMin:         { value: new THREE.Vector3(-0.6, -0.4, -0.1) },
  fromMax:         { value: new THREE.Vector3(0.6, 0.4, 0.1) },
  imageResolution: { value: new THREE.Vector2(imgW, imgH) },
  waveAmp:         { value: new THREE.Vector3(0.15, 0.1, 0.05) },
  fromScale:       { value: 0.6 },
  effectScale:     { value: 1.0 },
  imagePixelRatio: { value: 1.0 },
  seed:            { value: Math.random() * 100 },
  textTexture:     { value: textTexture },
  color:           { value: new THREE.Color(1.0, 1.0, 1.0) },
  opacity:         { value: 1.0 },
};

const material = new THREE.RawShaderMaterial({
  vertexShader,
  fragmentShader,
  uniforms,
  transparent: true,
  depthTest: false,
  blending: THREE.AdditiveBlending,
});

const mesh = new THREE.Mesh(baseGeometry, material);
scene.add(mesh);

// ============================================================
//  アニメーション制御 (lil-gui)
// ============================================================
const params = {
  state: 'scattered',
};

let currentA0 = 0.0;
let currentA1 = 0.0;

const gui = new GUI();
const actions = {
  scattered:  () => { params.state = 'scattered'; },
  gathered:   () => { params.state = 'gathered'; },
  scattered2: () => { params.state = 'scattered2'; },
};
gui.add(actions, 'scattered').name('散らばる');
gui.add(actions, 'gathered').name('集合');
gui.add(actions, 'scattered2').name('再散らばり');

const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);

  const dt = clock.getDelta();
  uniforms.time.value += dt * 1000;

  let targetA0, targetA1;
  if (params.state === 'scattered') {
    targetA0 = 0.0; targetA1 = 0.0;
  } else if (params.state === 'gathered') {
    targetA0 = 1.0; targetA1 = 0.0;
  } else {
    targetA0 = 1.0; targetA1 = 1.0;
  }

  const speed = 0.8;
  currentA0 += (targetA0 - currentA0) * Math.min(1, dt * speed);
  currentA1 += (targetA1 - currentA1) * Math.min(1, dt * speed);

  uniforms.animationValue0.value = currentA0;
  uniforms.animationValue1.value = currentA1;

  renderer.render(scene, camera);
}

animate();

// ============================================================
//  リサイズ対応
// ============================================================
window.addEventListener('resize', () => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);
  camera.left = -w / 2;
  camera.right = w / 2;
  camera.top = h / 2;
  camera.bottom = -h / 2;
  camera.updateProjectionMatrix();
});
