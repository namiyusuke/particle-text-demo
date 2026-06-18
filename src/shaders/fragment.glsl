precision highp float;
precision highp int;

uniform float time;
uniform sampler2D textTexture; // テキスト/写真のマップ（.a をマスクに使用）
uniform float opacity;         // 全体の不透明度

varying vec2 vUV;
varying vec2 vTextureUV;
varying float vA0;
varying float vA1;
varying float vRandomValueX;
varying vec3 vColor;           // パーティクルの色（写真の色 / テキスト単色）

void main(void) {
  vec2 uv = vUV * 2.0 - 1.0;

  float textureAlpha = texture2D(textTexture, vTextureUV).a;

  float circleAlpha = smoothstep(0.2, 0.8, length(uv));

  // ── glitter エフェクト ──
  float glitter = mix(
    (sin(time * 0.01 + vRandomValueX * 1000.0) + 1.0) * 0.5,
    1.0,
    1.0 - vA0
  );

  float alpha = textureAlpha * glitter;

  alpha *= smoothstep(0.0, 0.01 + 0.01 * vRandomValueX, 1.0 - vA0);

  alpha *= (1.0 - circleAlpha * smoothstep(0.0, 0.01, vA0));

  alpha *= smoothstep(0.1, 1.0, 1.0 - vA1);

  alpha *= (1.0 - circleAlpha * (1.0 - smoothstep(0.8, 1.0, 1.0 - vA1)));

  gl_FragColor = vec4(mix(vec3(1.0), vColor, glitter), alpha * opacity);
}
