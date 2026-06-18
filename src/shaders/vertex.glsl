precision highp float;
precision highp int;

// ── ジオメトリ attribute ──
attribute vec3 position;    // パーティクル四角形の頂点座標
attribute vec2 uv;          // パーティクル四角形のUV
attribute vec2 offset;      // テキスト/写真画像内でのパーティクル配置位置
attribute vec4 randomValues;// パーティクルごとのランダム値（動きのバリエーション用）
attribute vec3 instanceColor;// パーティクルごとの色（写真の色 / テキストの単色）

// ── 変換行列 ──
uniform mat4 modelMatrix;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;

// ── アニメーション制御 ──
uniform float animationValue0; // 0→1: 散らばり→集合
uniform float animationValue1; // 0→1: 集合→再散らばり
uniform float offsetCoef;      // アニメーション値の正規化係数

// ── 散らばりの範囲・パラメータ ──
uniform vec3 fromMin;         // 散らばり最小距離（imageResolution.yに掛けられる）
uniform vec3 fromMax;         // 散らばり最大距離
uniform vec2 imageResolution; // テキストテクスチャの解像度
uniform vec3 waveAmp;         // 浮遊時の波の振幅

// ── その他 ──
uniform float time;           // 経過時間（波の動きに使用）
uniform sampler2D textTexture;// テキストのアルファマップ
uniform float fromScale;      // 散らばり時のパーティクルスケール
uniform float effectScale;    // エフェクト全体のスケール
uniform float imagePixelRatio;
uniform float seed;           // ノイズのシード値
uniform float burstValue;     // クリック時の放射状バースト 0→1→0
uniform float burstAmp;       // バーストの飛距離（imageResolution.y 比）

// ── フラグメントシェーダーへ渡す varying ──
varying vec2 vUV;
varying vec2 vTextureUV;      // テキストテクスチャ上のUV（アルファ読み取り用）
varying float vA0;            // アニメーション0の進行度
varying float vA1;            // アニメーション1の進行度
varying float vRandomValueX;  // ランダム値（glitter用）
varying vec3 vColor;          // パーティクルの色

// ────────────────────────────────────────────
// getAnimationValueRandomDuration
// 全体のアニメーション値(aValue)から、各パーティクル固有の
// 開始タイミング(offset)と持続時間(duration)を計算し、
// そのパーティクルのローカルなアニメーション進行度を返す
// → パーティクルごとにバラバラのタイミングで動き出す仕組み
// ────────────────────────────────────────────
float getAnimationValueRandomDuration(
  float aValue,
  float randomValue1, float randomValue2,
  float minOffsetRatio, float maxOffsetRatio,
  float minDurationRatio, float maxDurationRatio
) {
  float offsetRatio = minOffsetRatio + (maxOffsetRatio - minOffsetRatio) * randomValue1;
  float durationRatioBase = 1.0 - maxOffsetRatio;
  float durationRatio = durationRatioBase * (minDurationRatio + (maxDurationRatio - minDurationRatio) * randomValue2);
  float vertexAnimationValue = max(0.0, aValue - offsetRatio);
  vertexAnimationValue = vertexAnimationValue / durationRatio;
  return clamp(vertexAnimationValue, 0.0, 1.0);
}

// ── 3D回転 ──
vec3 rotateVec3(vec3 p, float angle, vec3 axis) {
  vec3 a = normalize(axis);
  float s = sin(angle);
  float c = cos(angle);
  float r = 1.0 - c;
  mat3 m = mat3(
    a.x*a.x*r+c,       a.y*a.x*r+a.z*s, a.z*a.x*r-a.y*s,
    a.x*a.y*r-a.z*s,   a.y*a.y*r+c,       a.z*a.y*r+a.x*s,
    a.x*a.z*r+a.y*s,   a.y*a.z*r-a.x*s,   a.z*a.z*r+c
  );
  return m * p;
}

const float PI = 3.1415926535897932384626433832795;

// ── Simplex Noise（3D） ──
vec3 mod289(vec3 x) { return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314*r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
    i.z + vec4(0.0, i1.z, i2.z, 1.0))
    + i.y + vec4(0.0, i1.y, i2.y, 1.0))
    + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0)*2.0+1.0;
  vec4 s1 = floor(b1)*2.0+1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
  vec4 a1_0 = b1.xzyw + s1.xzyw*sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1_0.xy, h.z);
  vec3 p3 = vec3(a1_0.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}

// ── イージング関数 ──
float cubicOut(float t) { float f = t-1.0; return f*f*f+1.0; }
float cubicIn(float t) { return t*t*t; }
float cubicInOut(float t) {
  return t < 0.5 ? 4.0*t*t*t : 0.5*pow(2.0*t-2.0, 3.0)+1.0;
}

void main(void) {
  vec2 _coord = offset + imageResolution * 0.5;
  vec2 coord = _coord / imageResolution;
  vec2 coord2 = _coord / imageResolution.y;

  float snoiseValue = (snoise(vec3(coord2 * 2.0, seed)) + 1.0) * 0.5;

  // ── a0: 散らばり→集合 ──
  float a0 = getAnimationValueRandomDuration(
    min(animationValue0, offsetCoef) / offsetCoef,
    coord.x*0.6 + (1.0-coord.y)* 0.1 + snoiseValue*0.2 + randomValues.x*0.1,
    randomValues.y,
    0.0, 0.46, 0.7, 1.0
  );
  a0 = cubicInOut(1.0 - a0);

  // ── a1: 集合→再散らばり ──
  float a1 = getAnimationValueRandomDuration(
    min(animationValue1, offsetCoef) / offsetCoef,
    coord.y*0.6 + (1.0-coord.y)*0.1 + snoiseValue*0.3,
    randomValues.w,
    0.0, 0.66, 0.7, 1.0
  );
  a1 = cubicInOut(a1);

  // ── 位置計算 ──
  vec3 baseOffset = vec3(offset, 0.0);
  vec3 pos = position + baseOffset;

  vec3 _fromMin = fromMin * imageResolution.y;
  vec3 _fromMax = fromMax * imageResolution.y;
  vec3 _waveAmp = waveAmp * imageResolution.y;

  vec3 animationOffset = _fromMin + (_fromMax - _fromMin) * vec3(
    randomValues.x*0.5 + snoiseValue*0.5,
    randomValues.y*0.5 + snoiseValue*0.5,
    randomValues.z*0.5 + snoiseValue*0.5
  );

  float tx = time * 0.001 * 0.4 * (0.5 + 0.5*randomValues.w);
  float ty = time * 0.002 * 0.4 * (0.5 + 0.5*randomValues.x);
  float tz = time * 0.003 * 0.4 * (0.5 + 0.5*randomValues.y);

  // ── a0 による散らばり位置への補間 ──
  vec3 offset0 = vec3(
    animationOffset.x + _waveAmp.x*(0.4+0.6*randomValues.z)*sin(tx + snoiseValue*PI*4.0),
    animationOffset.y + _waveAmp.y*(0.4+0.6*randomValues.y)*sin(ty + snoiseValue*PI*2.0),
    animationOffset.z + _waveAmp.z*(0.4+0.6*randomValues.z)*sin(tz + snoiseValue*PI*3.0)
  ) * effectScale;

  pos = mix(pos, position * fromScale * effectScale * (0.2+0.8*randomValues.z) + baseOffset + offset0, a0);

  // ── a1 による再散らばり ──
  animationOffset.x *= -1.0;
  animationOffset.y *= -1.0;
  vec3 offset1 = vec3(
    animationOffset.x + _waveAmp.x*(0.4+0.6*randomValues.z)*sin(tx + snoiseValue*PI*4.0),
    animationOffset.y + _waveAmp.y*(0.4+0.6*randomValues.y)*sin(ty + snoiseValue*PI*2.0),
    animationOffset.z + _waveAmp.z*(0.4+0.6*randomValues.z)*sin(tz + snoiseValue*PI*3.0)
  ) * effectScale;

  pos = mix(pos, position * fromScale * effectScale * (0.2+0.8*randomValues.z) + baseOffset + offset1, a1);

  // ── クリック: 中心から四方への放射状バースト ──
  // offset = 画像中心からの相対位置 → その方向に外向きへ飛ばす。
  // 中心付近の粒も飛ぶよう、ランダムなジッターを加えてから正規化。
  vec2 burstDir = normalize(offset + (randomValues.xy - 0.5) * 80.0 + vec2(0.0001));
  float burstReach = burstAmp * imageResolution.y * (0.5 + 0.7 * randomValues.z);
  pos.xy += burstDir * burstValue * burstReach;
  pos.z  += (randomValues.w - 0.5) * burstValue * burstAmp * imageResolution.y * 0.4;

  // ── Varying 出力 ──
  vUV = uv;

  vec2 textureCoord = offset + position.xy + imageResolution * 0.5;
  textureCoord.y = imageResolution.y - textureCoord.y;
  vTextureUV = textureCoord / imageResolution;
  vTextureUV.y = 1.0 - vTextureUV.y;

  vRandomValueX = randomValues.x;
  vA0 = a0;
  vA1 = a1;
  vColor = instanceColor;

  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(pos, 1.0);
}
