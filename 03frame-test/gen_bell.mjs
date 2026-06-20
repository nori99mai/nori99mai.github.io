// gen_bell.mjs — お寺の鐘（梵鐘）のプレースホルダ音をWAVで合成する
// より本物に寄せた版：打撃トランジェント＋低いハム＋うなり（beating）＋長い余韻
// 本物に差し替えるなら 03frame-test/ に bell.mp3 を置けばアプリが優先的に使う（gen不要）
// 使い方: node gen_bell.mjs  → bell.wav を出力
import { writeFileSync } from 'fs';

const sampleRate = 44100;
const duration = 5.5;             // 秒（梵鐘の長い余韻）
const n = Math.floor(sampleRate * duration);

// 梵鐘の部分音（絶対周波数）。[Hz, 相対音量, 減衰/秒, うなり用デチューンHz]
const partials = [
  [ 82,  1.00, 0.45, 0.0 ],   // hum（唸り・最も長く残る）
  [164,  0.80, 0.55, 0.7 ],   // prime
  [197,  0.50, 0.70, 0.5 ],   // tierce（短三度）→ 鐘らしい陰り
  [246,  0.45, 0.80, 0.6 ],   // quint
  [328,  0.55, 0.75, 0.0 ],   // nominal（オクターブ）＝音程の聞こえ
  [492,  0.28, 1.10, 0.9 ],
  [656,  0.20, 1.40, 0.0 ],
  [880,  0.14, 1.80, 1.1 ],
  [1230, 0.10, 2.40, 0.0 ],
];

const buf = new Float32Array(n);
for (let i = 0; i < n; i++) {
  const t = i / sampleRate;
  let s = 0;
  for (const [f, amp, decay, beat] of partials) {
    const env = Math.exp(-decay * t);
    if (beat > 0) {
      // 2本をわずかにずらして重ねる→ゆっくりした「うなり」
      s += amp * 0.5 * env * Math.sin(2 * Math.PI * (f - beat / 2) * t);
      s += amp * 0.5 * env * Math.sin(2 * Math.PI * (f + beat / 2) * t);
    } else {
      s += amp * env * Math.sin(2 * Math.PI * f * t);
    }
  }
  // 打撃トランジェント：最初の~0.18sだけ金属的な高域＋ノイズ
  const strikeEnv = Math.exp(-22 * t);
  const metallic = (Math.sin(2 * Math.PI * 2600 * t) + 0.6 * Math.sin(2 * Math.PI * 4100 * t)) * 0.35;
  const noise = (Math.random() * 2 - 1) * Math.exp(-60 * t) * 0.25;
  s += strikeEnv * metallic + noise;

  // 立ち上がりのクリック防止（最初の3ms）
  if (t < 0.003) s *= t / 0.003;
  buf[i] = s;
}

// 正規化
let peak = 0;
for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(buf[i]));
const gain = peak > 0 ? 0.92 / peak : 1;

// 16bit PCM WAV（mono）
const bytesPerSample = 2;
const dataSize = n * bytesPerSample;
const out = Buffer.alloc(44 + dataSize);
out.write('RIFF', 0); out.writeUInt32LE(36 + dataSize, 4); out.write('WAVE', 8);
out.write('fmt ', 12); out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22);
out.writeUInt32LE(sampleRate, 24); out.writeUInt32LE(sampleRate * bytesPerSample, 28);
out.writeUInt16LE(bytesPerSample, 32); out.writeUInt16LE(16, 34);
out.write('data', 36); out.writeUInt32LE(dataSize, 40);
for (let i = 0; i < n; i++) {
  let v = Math.round(buf[i] * gain * 32767);
  v = Math.max(-32768, Math.min(32767, v));
  out.writeInt16LE(v, 44 + i * bytesPerSample);
}
writeFileSync(new URL('./bell.wav', import.meta.url), out);
console.log('bell.wav written:', dataSize + 44, 'bytes,', duration + 's');
