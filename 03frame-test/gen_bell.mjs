// gen_bell.mjs — お寺の鐘のプレースホルダ音をWAVで合成する（本物は効果音ラボ等で差し替え予定）
// 使い方: node gen_bell.mjs  → bell.wav を出力
import { writeFileSync } from 'fs';

const sampleRate = 44100;
const duration = 3.5;            // 秒（鐘の余韻）
const n = Math.floor(sampleRate * duration);

// 梵鐘っぽい非整数倍音（低い基音＋うなり）。[周波数倍率, 相対音量, 減衰の速さ]
const f0 = 150;
const partials = [
  [1.00, 1.00, 0.6],
  [2.01, 0.55, 0.9],
  [2.78, 0.40, 1.1],
  [3.94, 0.28, 1.4],
  [5.40, 0.18, 1.9],
  [6.80, 0.12, 2.4],
];

const buf = new Float32Array(n);
for (let i = 0; i < n; i++) {
  const t = i / sampleRate;
  let s = 0;
  for (const [mult, amp, decay] of partials) {
    s += amp * Math.sin(2 * Math.PI * f0 * mult * t) * Math.exp(-decay * t);
  }
  // 打撃の立ち上がり（最初の数ms）＋カーンという金属的な高域
  const strike = Math.exp(-40 * t) * Math.sin(2 * Math.PI * 2400 * t) * 0.5;
  buf[i] = s + strike;
}

// 正規化
let peak = 0;
for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(buf[i]));
const gain = peak > 0 ? 0.9 / peak : 1;

// 16bit PCM WAV
const bytesPerSample = 2;
const dataSize = n * bytesPerSample;
const out = Buffer.alloc(44 + dataSize);
out.write('RIFF', 0);
out.writeUInt32LE(36 + dataSize, 4);
out.write('WAVE', 8);
out.write('fmt ', 12);
out.writeUInt32LE(16, 16);
out.writeUInt16LE(1, 20);            // PCM
out.writeUInt16LE(1, 22);            // mono
out.writeUInt32LE(sampleRate, 24);
out.writeUInt32LE(sampleRate * bytesPerSample, 28);
out.writeUInt16LE(bytesPerSample, 32);
out.writeUInt16LE(16, 34);
out.write('data', 36);
out.writeUInt32LE(dataSize, 40);
for (let i = 0; i < n; i++) {
  let v = Math.round(buf[i] * gain * 32767);
  v = Math.max(-32768, Math.min(32767, v));
  out.writeInt16LE(v, 44 + i * bytesPerSample);
}
writeFileSync(new URL('./bell.wav', import.meta.url), out);
console.log('bell.wav written:', dataSize + 44, 'bytes');
