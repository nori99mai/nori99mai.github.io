/* =====================================================================
   014 木のアプリ ─ Phase1 プロトタイプ（仮の絵版・保存なし）
   ---------------------------------------------------------------------
   ・10秒タップ → 10段階で木が育つ → 身長cm・ポイント表示 → もう一回
   ・絵は仮（SVGプレースホルダー）。assets/stage1.png〜stage10.png を
     置くと自動でそちらに差し替わる（後フェーズ／お子さんの絵用）。
   ・数値バランス(CONFIG)は「触りながら調整」する前提＝凍結対象外。
   ===================================================================== */

'use strict';

/* ---------------------------------------------------------------
   CONFIG ─ バランス調整はここだけ触ればOK（spec ⑦-2）
   --------------------------------------------------------------- */
const CONFIG = {
  roundSeconds: 10,            // 1ラウンドの秒数
  stages: 10,                  // 段階数

  // タップ1回の成長量(cm) = growthPerTap × state.tapBoost。コンボ無し＝タップは一定
  growthPerTap: 46,

  cameraFit: 0.72,             // 木を画面高さの何割に収めるか（ズームアウトの効き）

  // 段階の境界(cm)。stage1=0〜, ... index0→stage1。現実サイズ上限(約90m級)
  stageThresholdsCm: [0, 20, 60, 150, 380, 850, 1800, 3600, 6000, 9000],

  // 各段階の見た目の高さ(px)。育つほど大きく＝カメラが引く演出に使う
  stageHeightPx: [70, 110, 165, 240, 350, 510, 730, 1040, 1480, 2200],

  pointRate: 0.12,             // ポイント = floor(身長cm * pointRate)

  // 段階アップ演出の濃淡（spec ⑦-3）。'heavy' は厚め、'light' は軽め、既定は 'mid'
  heavyStageUps: [4, 8, 9],    // 「3→4」「7→8」「8→9」到達時を厚めに
  lightStageUps: [2, 3],       // 「1→2」「2→3」到達は軽め
};

/* ---------------------------------------------------------------
   状態
   --------------------------------------------------------------- */
const state = {
  tutorialSeen: false,   // セッション内で初回のみチュートリアル
  running: false,
  taps: 0,
  tapBoost: 1,           // タップの威力（「+N」表示）。Phase1は1固定。将来、肥料等で+5等に上がる
  growthCm: 0,
  stage: 1,
  endTime: 0,
  rafId: 0,
  countingDown: false,
  countTimer: 0,
};

/* ---------------------------------------------------------------
   DOM ショートカット
   --------------------------------------------------------------- */
const $ = (id) => document.getElementById(id);
const screens = {
  start: $('screen-start'),
  tutorial: $('screen-tutorial'),
  countdown: $('screen-countdown'),
  play: $('screen-play'),
  result: $('screen-result'),
  star: $('screen-star'),
};
function show(name) {
  Object.values(screens).forEach((s) => s.classList.add('hidden'));
  screens[name].classList.remove('hidden');
}

/* ===============================================================
   音 ─ Web Audio でコード合成（素材調達ゼロ）。初回タップでアンロック
   =============================================================== */
const Sound = (() => {
  let ctx = null;
  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) ctx = new AC();
    }
    if (ctx && ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function tone(freq, dur, type, gain, when) {
    const c = ensure(); if (!c) return;
    const t = (when || c.currentTime);
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type || 'triangle';
    osc.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain || 0.18, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(c.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }
  return {
    unlock: ensure,
    tap() {
      const f = 540 + Math.random() * 20;
      tone(f, 0.10, 'triangle', 0.14);
    },
    grow(level) {
      // 段階アップ。level: 'light' | 'mid' | 'heavy'
      const c = ensure(); if (!c) return;
      const base = level === 'heavy' ? 523 : level === 'light' ? 440 : 494;
      const notes = level === 'heavy' ? [base, base * 1.26, base * 1.5] : [base, base * 1.5];
      notes.forEach((n, i) => tone(n, 0.22, 'sine', 0.16, c.currentTime + i * 0.06));
    },
    boom() {
      // stage10 到達の「ドン」
      const c = ensure(); if (!c) return;
      tone(70, 0.5, 'sine', 0.35);
      [392, 523, 659, 784].forEach((n, i) => tone(n, 0.5, 'sine', 0.16, c.currentTime + 0.05 + i * 0.07));
    },
    countBeep(go) {
      tone(go ? 880 : 440, go ? 0.25 : 0.12, 'square', 0.14);
    },
    fanfare() {
      const c = ensure(); if (!c) return;
      [523, 659, 784, 1047].forEach((n, i) => tone(n, 0.3, 'triangle', 0.15, c.currentTime + i * 0.10));
    },
  };
})();

/* ===============================================================
   木の描画 ─ assets/stageN.png があれば使い、無ければ仮SVG
   =============================================================== */
const assetUrl = {};   // stage番号 → 画像URL（存在するものだけ）

// 起動時に各段階の画像を試し読み。あった段階だけ assetUrl に登録。
function preloadAssets() {
  for (let s = 1; s <= CONFIG.stages; s++) {
    const url = `assets/stage${s}.png`;
    const img = new Image();
    img.onload = () => { assetUrl[s] = url; };
    img.onerror = () => { /* 無ければ仮SVGのまま */ };
    img.src = url;
  }
}

// 仮の木（SVG文字列）。段階に応じて大きく・複雑に。stage10だけ色を化けさせる。
function placeholderSVG(stage) {
  const h = CONFIG.stageHeightPx[stage - 1];
  const w = Math.round(h * 0.85);
  const cx = w / 2;
  const trunkW = Math.max(4, w * 0.07 * (0.5 + stage * 0.06));
  const trunkH = h * (stage <= 2 ? 0.30 : 0.46);
  const groundY = h;                       // 足元
  const isGiant = stage >= 10;
  const leaf = isGiant ? '#2f6e3a' : '#5fb568';
  const leaf2 = isGiant ? '#234f2a' : '#4a9c53';
  const bark = isGiant ? '#5b4632' : '#8d6748';

  let parts = '';
  if (stage <= 2) {
    // 芽：細い茎＋双葉
    const stemH = h * 0.5;
    parts += `<rect x="${cx - trunkW / 2}" y="${groundY - stemH}" width="${trunkW}" height="${stemH}" rx="${trunkW / 2}" fill="${bark}"/>`;
    const lr = w * 0.22;
    parts += `<ellipse cx="${cx - lr * 0.6}" cy="${groundY - stemH}" rx="${lr}" ry="${lr * 0.6}" fill="${leaf}" transform="rotate(-25 ${cx - lr * 0.6} ${groundY - stemH})"/>`;
    parts += `<ellipse cx="${cx + lr * 0.6}" cy="${groundY - stemH}" rx="${lr}" ry="${lr * 0.6}" fill="${leaf}" transform="rotate(25 ${cx + lr * 0.6} ${groundY - stemH})"/>`;
    if (stage === 2) parts += `<ellipse cx="${cx}" cy="${groundY - stemH - lr * 0.5}" rx="${lr * 0.7}" ry="${lr * 0.5}" fill="${leaf2}"/>`;
  } else {
    // 幹
    parts += `<rect x="${cx - trunkW / 2}" y="${groundY - trunkH}" width="${trunkW}" height="${trunkH}" rx="${trunkW * 0.3}" fill="${bark}"/>`;
    // 樹冠：段階が上がるほど大きく重ねる
    const canopyR = w * (0.26 + stage * 0.02);
    const top = groundY - trunkH;
    const blobs = Math.min(3 + stage, 9);
    for (let i = 0; i < blobs; i++) {
      const ang = (i / blobs) * Math.PI * 2;
      const rr = canopyR * (0.55 + (i % 3) * 0.18);
      const bx = cx + Math.cos(ang) * canopyR * 0.5;
      const by = top - canopyR * 0.5 + Math.sin(ang) * canopyR * 0.4;
      parts += `<circle cx="${bx}" cy="${by}" r="${rr}" fill="${i % 2 ? leaf2 : leaf}"/>`;
    }
    parts += `<circle cx="${cx}" cy="${top - canopyR * 0.5}" r="${canopyR}" fill="${leaf}"/>`;
    if (isGiant) {
      // 巨木：金色の光輪（仮）
      parts += `<circle cx="${cx}" cy="${top - canopyR * 0.5}" r="${canopyR * 1.15}" fill="none" stroke="rgba(255,215,90,.5)" stroke-width="${w * 0.02}"/>`;
    }
  }
  // 「仮」ラベル
  const fontSize = Math.max(11, w * 0.05);
  parts += `<text x="${cx}" y="${groundY - 4}" font-size="${fontSize}" fill="rgba(0,0,0,.28)" text-anchor="middle">仮 stage${stage}</text>`;

  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">${parts}</svg>`;
}

// 指定のラッパに、その段階の木を描いてカメラ(scale)を合わせる
function renderTree(wrapEl, stage) {
  const heightPx = CONFIG.stageHeightPx[stage - 1];
  if (assetUrl[stage]) {
    wrapEl.innerHTML = `<img src="${assetUrl[stage]}" alt="stage${stage}" style="height:${heightPx}px;width:auto;">`;
  } else {
    wrapEl.innerHTML = placeholderSVG(stage);
  }
  applyCamera(wrapEl, stage);
}

// 育つほど引く（ズームアウト）。利用可能な高さに収まるよう scale を決める
function applyCamera(wrapEl, stage) {
  const heightPx = CONFIG.stageHeightPx[stage - 1];
  const avail = wrapEl.parentElement.clientHeight * CONFIG.cameraFit;  // 画面の指定割合に収める
  const scale = Math.min(1, avail / heightPx);
  wrapEl.dataset.scale = String(scale);
  wrapEl.style.transform = `translateX(-50%) scale(${scale})`;
}

/* ===============================================================
   エフェクト ─ 「+N」表示 と 葉/キラキラ（上限プールで使い回す）
   =============================================================== */
const floatPool = [];
const FLOAT_MAX = 18;
function floatPlus(amount) {
  const layer = $('float-play');
  let el = floatPool.find((e) => e._free);
  if (!el && floatPool.length < FLOAT_MAX) {
    el = document.createElement('div');
    el.className = 'float-plus';
    layer.appendChild(el);
    floatPool.push(el);
  }
  if (!el) return; // 上限。出さずに間引く
  el._free = false;
  el.textContent = `+${amount}`;
  const x = 50 + (Math.random() * 24 - 12);
  el.style.left = x + '%';
  el.style.transform = 'translate(-50%, 0) scale(1)';
  el.style.opacity = '1';
  // 上へスライドして消える（約1秒）
  requestAnimationFrame(() => {
    el.style.transition = 'transform 1s ease-out, opacity 1s ease-out';
    el.style.transform = 'translate(-50%, -90px) scale(1.1)';
    el.style.opacity = '0';
  });
  clearTimeout(el._t);
  el._t = setTimeout(() => {
    el.style.transition = 'none';
    el._free = true;
  }, 1050);
}

const partPool = [];
const PART_MAX = 28;
const LEAF_COLORS = ['#7ec97f', '#5fb568', '#a5d6a7', '#ffe082'];
function spawnParticles(n) {
  const layer = $('fx-play');
  const rect = layer.getBoundingClientRect();
  const baseX = rect.width / 2;
  const baseY = rect.height * 0.55;
  for (let i = 0; i < n; i++) {
    let el = partPool.find((e) => e._free);
    if (!el && partPool.length < PART_MAX) {
      el = document.createElement('div');
      el.className = 'particle';
      layer.appendChild(el);
      partPool.push(el);
    }
    if (!el) return;
    el._free = false;
    const sparkle = Math.random() < 0.4;
    el.style.background = sparkle ? '#fff7c2' : LEAF_COLORS[(Math.random() * LEAF_COLORS.length) | 0];
    el.style.borderRadius = sparkle ? '50%' : '50% 0 50% 50%';
    const sx = baseX + (Math.random() * 80 - 40);
    const sy = baseY + (Math.random() * 40 - 20);
    el.style.left = sx + 'px';
    el.style.top = sy + 'px';
    el.style.opacity = '1';
    el.style.transform = 'translate(0,0) rotate(0deg) scale(1)';
    const dx = (Math.random() * 120 - 60);
    const dy = -(40 + Math.random() * 90);
    const rot = Math.random() * 360;
    requestAnimationFrame(() => {
      el.style.transition = 'transform .9s ease-out, opacity .9s ease-out';
      el.style.transform = `translate(${dx}px, ${dy}px) rotate(${rot}deg) scale(.4)`;
      el.style.opacity = '0';
    });
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.style.transition = 'none'; el._free = true; }, 950);
  }
}

function flash(gold) {
  const f = $('flash');
  f.classList.toggle('gold', !!gold);
  f.style.transition = 'none';
  f.style.opacity = gold ? '1' : '0.7';
  requestAnimationFrame(() => {
    f.style.transition = 'opacity .5s ease-out';
    f.style.opacity = '0';
  });
}

// 木をぷるんと弾ませる（タップのたび）
function bounceTree() {
  const wrap = $('tree-wrap-play');
  const scale = parseFloat(wrap.dataset.scale || '1');
  wrap.style.transition = 'transform .08s ease-out';
  wrap.style.transform = `translateX(-50%) scale(${scale * 1.04})`;
  clearTimeout(wrap._b);
  wrap._b = setTimeout(() => {
    wrap.style.transition = 'transform .12s ease-out';
    wrap.style.transform = `translateX(-50%) scale(${scale})`;
  }, 80);
}

/* ===============================================================
   ゲーム本体
   =============================================================== */
function stageForCm(cm) {
  let s = 1;
  for (let i = 0; i < CONFIG.stageThresholdsCm.length; i++) {
    if (cm >= CONFIG.stageThresholdsCm[i]) s = i + 1;
  }
  return s;
}

// カウントダウンの保留タイマーを必ず止める（多重起動・置き去り防止）
function clearCountdown() {
  state.countingDown = false;
  if (state.countTimer) { clearTimeout(state.countTimer); state.countTimer = 0; }
}

function startCountdown() {
  if (state.countingDown || state.running) return;   // 多重起動ガード
  state.countingDown = true;
  show('countdown');
  const el = $('count-big');
  let n = 3;
  const step = () => {
    if (n > 0) {
      el.textContent = String(n);
      el.style.animation = 'none';
      void el.offsetWidth;            // リフロー強制でアニメ再生
      el.style.animation = 'countpop .9s ease-out';
      Sound.countBeep(false);
      n--;
      state.countTimer = setTimeout(step, 900);
    } else {
      el.textContent = 'GO!';
      Sound.countBeep(true);
      state.countTimer = setTimeout(beginRound, 500);
    }
  };
  step();
}

function beginRound() {
  clearCountdown();
  state.running = true;
  state.taps = 0;
  state.growthCm = 0;
  state.stage = 1;
  const now = performance.now();
  state.endTime = now + CONFIG.roundSeconds * 1000;

  show('play');
  $('timer').classList.remove('warn');
  renderTree($('tree-wrap-play'), 1);
  loop();
}

function loop() {
  const now = performance.now();
  const remain = Math.max(0, state.endTime - now);

  // タイマー表示
  const sec = remain / 1000;
  $('timer').textContent = sec.toFixed(1);
  if (sec <= 3 && state.running) $('timer').classList.add('warn');

  if (remain <= 0) { endRound(); return; }
  state.rafId = requestAnimationFrame(loop);
}

function onTap() {
  const now = performance.now();
  if (!state.running || now >= state.endTime) return;  // 終了時刻を過ぎたタップは無効(表示と結果のズレ防止)

  state.taps++;
  state.growthCm += CONFIG.growthPerTap * state.tapBoost;  // タップ＝一定（tapBoostは将来アイテムで上がる）

  // 演出：「+1」をタップごとに表示
  Sound.tap();
  bounceTree();
  floatPlus(state.tapBoost);
  spawnParticles(1);

  // 段階アップ判定：一気に飛んでも演出は最終段のみ（多重発火を避ける）
  const newStage = stageForCm(state.growthCm);
  if (newStage > state.stage) {
    state.stage = newStage;
    onStageUp(newStage);
  }
}

function onStageUp(stage) {
  renderTree($('tree-wrap-play'), stage);
  let level = 'mid';
  if (CONFIG.heavyStageUps.includes(stage)) level = 'heavy';
  else if (CONFIG.lightStageUps.includes(stage)) level = 'light';

  if (stage >= CONFIG.stages) {
    // 最終段階＝ガラリ演出（金の光・ドン）
    flash(true);
    Sound.boom();
    spawnParticles(12);
  } else if (level === 'heavy') {
    flash(false);
    Sound.grow('heavy');
    spawnParticles(8);
  } else if (level === 'light') {
    Sound.grow('light');
    spawnParticles(2);
  } else {
    Sound.grow('mid');
    spawnParticles(4);
  }
}

function endRound() {
  state.running = false;
  cancelAnimationFrame(state.rafId);
  showResult();
}

function showResult() {
  const cm = state.growthCm;
  const points = Math.floor(cm * CONFIG.pointRate);

  renderTree($('tree-wrap-result'), state.stage);   // 育成中の最終段階をそのまま使う
  show('result');
  Sound.fanfare();

  // 身長cm カウントアップ
  const cmEl = $('res-cm');
  const ptEl = $('res-pt');
  ptEl.textContent = '+0';
  const dur = 900;
  const t0 = performance.now();
  const tick = (t) => {
    const k = Math.min(1, (t - t0) / dur);
    const eased = 1 - Math.pow(1 - k, 3);
    cmEl.textContent = Math.floor(cm * eased).toLocaleString();
    if (k < 1) requestAnimationFrame(tick);
    else { cmEl.textContent = cm.toLocaleString(); ptEl.textContent = `+${points}`; }
  };
  requestAnimationFrame(tick);
}

/* ===============================================================
   画面遷移の配線
   =============================================================== */
function goPlay() {
  Sound.unlock();
  if (!state.tutorialSeen) {
    show('tutorial');                 // 初回のみチュートリアル
  } else {
    startCountdown();                 // もう一回は 3・2・1 から
  }
}

$('btn-play').addEventListener('click', goPlay);
$('btn-tutorial-start').addEventListener('click', () => {
  state.tutorialSeen = true;
  startCountdown();
});
function goStart() {
  clearCountdown();
  state.running = false;
  show('start');
}
$('btn-star').addEventListener('click', () => { Sound.unlock(); show('star'); });
$('btn-star-back').addEventListener('click', goStart);

// 結果 → もう一回（破棄確認）
$('btn-again').addEventListener('click', () => openConfirm('もう一回'));
$('btn-home').addEventListener('click', () => openConfirm('スタート'));

function openConfirm(dest) {
  $('dialog-text').textContent =
    dest === 'もう一回' ? '育てた木を捨てて、もう一回？' : '育てた木を捨てて、スタートに戻る？';
  $('dialog-confirm').dataset.dest = dest;
  $('dialog-confirm').classList.remove('hidden');
}
$('dlg-no').addEventListener('click', () => $('dialog-confirm').classList.add('hidden'));
$('dlg-yes').addEventListener('click', () => {
  const dest = $('dialog-confirm').dataset.dest;
  $('dialog-confirm').classList.add('hidden');
  if (dest === 'もう一回') startCountdown();  // チュートリアルは飛ばす
  else goStart();
});

// タップ受け：pointerdown で遅延ゼロ（passive）
const tapCatch = $('tap-catch');
tapCatch.addEventListener('pointerdown', (e) => { e.preventDefault(); onTap(); }, { passive: false });

// 画面回転・リサイズでカメラを合わせ直す
window.addEventListener('resize', () => {
  if (!screens.play.classList.contains('hidden')) applyCamera($('tree-wrap-play'), state.stage);
});

/* 起動 */
preloadAssets();
show('start');
