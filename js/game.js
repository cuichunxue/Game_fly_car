/* ============================================================
 * Thrust Roadster ULTRA — game core
 * physics, input (keyboard / touch / gamepad), camera, HUD, flow
 * ============================================================ */
(() => {
'use strict';
const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));
const W = TR.World, Md = TR.Models, FX = TR.FX, AU = TR.Audio;

/* ---------- tuning ---------- */
const DIFF = {
  easy:   { key: 'easy',   label: 'かんたん',   v0: 21, v1: 34, drain: 21, recharge: 26, lives: 5, gapK: .85, obst: .45 },
  normal: { key: 'normal', label: 'ふつう',     v0: 25, v1: 43, drain: 26, recharge: 20, lives: 3, gapK: 1,   obst: .65 },
  hard:   { key: 'hard',   label: 'むずかしい', v0: 29, v1: 52, drain: 31, recharge: 16, lives: 3, gapK: 1.15, obst: .85 },
};
// arcade physics (not a real-world simulation)
const PH = { G: 22, JUMP: 9.6, THRUST: 36, CUSHION: 18, VYMAX: 10.5, CEIL0: 8, CEIL1: 13, JUMP_COST: 4, BOOST: 1.38, BOOST_DRAIN: 24,
  LAT: 12.5, CAR_HW: .95, CAR_HL: 2.25, CRASH_V: 21.5, PERFECT_V: 7.5, HARD_V: 13.5, COYOTE: .16 };
const QUAL = {
  high: { dpr: 2,   shadow: 2048, bloom: true,  bloomScale: 1,  msaa: true },
  mid:  { dpr: 1.5, shadow: 1024, bloom: true,  bloomScale: .6, msaa: false },
  low:  { dpr: 1,   shadow: 0,    bloom: false, bloomScale: .5, msaa: false },
};
const isTouch = () => matchMedia('(pointer: coarse)').matches || ('ontouchstart' in window && navigator.maxTouchPoints > 0);

/* ---------- settings ---------- */
function load(k, d){ try { const v = JSON.parse(localStorage.getItem(k)); return v ? Object.assign({}, d, v) : d; } catch(e){ return d; } }
function save(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch(e){} }
const settings = load('tr_ultra_settings', { music: .6, sfx: .8, quality: 'auto', guide: true, motion: matchMedia('(prefers-reduced-motion: reduce)').matches, paint: 'pearl' });
if (!TR.Tex.PAINTS[settings.paint]) settings.paint = 'pearl';
const bestOf = d => { try { return +(localStorage.getItem('tr_ultra_best_' + d) || 0); } catch(e){ return 0; } };
const setBest = (d, v) => { try { localStorage.setItem('tr_ultra_best_' + d, String(v)); } catch(e){} };

/* ---------- renderer ---------- */
const stage = $('stage');
let renderer;
try { renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false }); }
catch(e){ $('loading').innerHTML = '<div class="card" style="margin:auto"><h2>3D画面を開けませんでした</h2><p class="lead">WebGL対応の最新のChrome / Safari / Edgeで開いてください。</p><button class="go" onclick="location.reload()"><span>再読み込み</span></button></div>'; return; }
TR.renderer = renderer;
renderer.outputEncoding = THREE.LinearEncoding; renderer.toneMapping = THREE.NoToneMapping;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
stage.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(64, 1, .25, 2400);
scene.add(camera);

let qualityKey = settings.quality === 'auto' ? (isTouch() ? 'mid' : 'high') : settings.quality;
let Q = QUAL[qualityKey];

/* ---------- post-processing ---------- */
const FinalShader = {
  uniforms: { tDiffuse: { value: null }, exposure: { value: 1 }, vignette: { value: .55 }, grain: { value: .035 }, time: { value: 0 }, aberr: { value: 0 }, blur: { value: 0 }, sat: { value: 1.08 }, res: { value: new THREE.Vector2(1, 1) }, tint: { value: new THREE.Color(0, 0, 0) } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float exposure, vignette, grain, time, aberr, blur, sat; uniform vec2 res; uniform vec3 tint;
    varying vec2 vUv;
    vec3 aces(vec3 x){ return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14), 0., 1.); }
    vec3 srgb(vec3 c){ return mix(c*12.92, 1.055*pow(c, vec3(1./2.4)) - .055, step(.0031308, c)); }
    void main(){
      vec2 dc = vUv - .5; vec3 col;
      if (blur > .002){ vec3 acc = vec3(0.); for (int i = 0; i < 7; i++){ float s = 1. - blur*float(i)*.012; acc += texture2D(tDiffuse, .5 + dc*s).rgb; } col = acc/7.; }
      else col = texture2D(tDiffuse, vUv).rgb;
      if (aberr > .001){ float a = aberr*.006*length(dc)*2.; col.r = texture2D(tDiffuse, vUv + dc*a).r; col.b = texture2D(tDiffuse, vUv - dc*a).b; }
      col = col*exposure + tint;
      col = aces(col);
      float l = dot(col, vec3(.2126,.7152,.0722)); col = mix(vec3(l), col, sat);
      float v = smoothstep(.95, .25, length(dc*vec2(1., .82))); col *= mix(1., v, vignette);
      col = srgb(col);
      col += (fract(sin(dot(vUv*res + time*61.7, vec2(12.9898,78.233)))*43758.5453) - .5)*grain;
      gl_FragColor = vec4(col, 1.);
    }`
};
let composer, bloom, finalPass;
function buildComposer(){
  if (composer){ composer.renderTarget1.dispose(); composer.renderTarget2.dispose(); }
  const pr = renderer.getPixelRatio(), w = innerWidth, h = innerHeight;
  const rt = new THREE.WebGLRenderTarget(w * pr, h * pr, { type: THREE.HalfFloatType, stencilBuffer: true, samples: (renderer.capabilities.isWebGL2 && Q.msaa) ? 4 : 0 }); // stencil => 24-bit depth
  composer = new THREE.EffectComposer(renderer, rt);
  composer.addPass(new THREE.RenderPass(scene, camera));
  bloom = new THREE.UnrealBloomPass(new THREE.Vector2(w, h), .65, .5, 1.0);
  bloom.enabled = Q.bloom; composer.addPass(bloom);
  finalPass = new THREE.ShaderPass(FinalShader); composer.addPass(finalPass);
}
function applyQuality(){
  Q = QUAL[qualityKey];
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, Q.dpr));
  W.setShadowSize(Q.shadow);
  buildComposer(); resize();
}
let baseFov = 64;
function resize(){
  const w = innerWidth, h = innerHeight, pr = renderer.getPixelRatio();
  renderer.setSize(w, h, false);
  if (composer){ composer.setPixelRatio(pr); composer.setSize(w, h); bloom.setSize(w * pr * Q.bloomScale, h * pr * Q.bloomScale); finalPass.uniforms.res.value.set(w * pr, h * pr); }
  camera.aspect = w / h; baseFov = camera.aspect < 1 ? 80 : camera.aspect < 1.4 ? 70 : 63; camera.updateProjectionMatrix();
  FX.setPointScale(h * pr / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)));
}
addEventListener('resize', resize);

/* ---------- state ---------- */
const S = {
  mode: 'loading', diffKey: 'normal', diff: DIFF.normal, players: 1, cur: 0, results: [],
  x: 0, y: 0, z: 0, vx: 0, vy: 0, speed: 0, air: 100, grounded: true, lives: 3, refBase: 0, coyote: 0,
  score: 0, dist: 0, rings: 0, perfects: 0, rolls: 0, nearMiss: 0, maxAir: 0, airTime: 0, combo: 0, comboT: 0, maxMult: 1,
  crashT: 0, invuln: 0, countdown: 0, lastG: 1, roll: 0, rollDir: 0, rolling: false, steerHold: 0, flightRings: 0,
  fold: 0, thrustNow: 0, boostNow: false, zone: 0, missionsDone: {}, hints: {}, lastReason: '', shake: 0, slowmo: 0, timeScale: 1, scrapeT: 0,
};
const input = { kL: false, kR: false, kT: false, kB: false, tSteer: 0, tT: false, tB: false, pSteer: 0, pT: false, pB: false, steer: 0, thrust: false, boost: false, prevThrust: false };

/* ---------- player car ---------- */
let car;
const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3();

/* ---------- boot sequence (with loading bar) ---------- */
function setLoad(p, txt){ $('loadFill').style.width = (p * 100) + '%'; if (txt) $('loadTxt').textContent = txt; }
const bootSteps = [
  ['道路と空を描いています…', () => { TR.Tex.road(); TR.Tex.concrete(); TR.Tex.hazard(); TR.Tex.chevron(); }],
  ['ボディを塗装しています…', () => { TR.Tex.livery(settings.paint); TR.Tex.tire(); TR.Tex.carbon(); }],
  ['街と山を建てています…', () => { for (let i = 0; i < 4; i++) TR.Tex.facade(i); for (let i = 0; i < 6; i++) TR.Tex.billboard(i); TR.Tex.cityGround(); }],
  ['砂漠と氷河を広げています…', () => { TR.Tex.sand(); TR.Tex.rockStrata(); TR.Tex.snow(); TR.Tex.ice(); for (let i = 0; i < 4; i++) TR.Tex.container(i); }],
  ['光を灯しています…', () => { W.init(scene, renderer); FX.init(scene); applyQuality(); }],
  ['ロードスターを組み立てています…', () => { car = Md.playerCar(settings.paint); scene.add(car); car.traverse(o => { if (o.isMesh) o.castShadow = o.castShadow || false; }); }],
  ['コースを敷いています…', () => { W.runwayOnly(S.diff); W.setZoneBlend(0); }],
  ['シェーダーを準備しています…', () => { camera.position.set(6, 2.4, 6); camera.lookAt(0, 1, 0); renderer.compile(scene, camera); }],
];
let bootI = 0;
function boot(){
  if (bootI < bootSteps.length){
    const [txt, fn] = bootSteps[bootI]; setLoad(bootI / bootSteps.length, txt);
    setTimeout(() => { try { fn(); } catch(e){ console.error(e); } bootI++; boot(); }, 16);
    return;
  }
  setLoad(1, 'READY');
  buildTitleUI(); goTitle();
  setTimeout(() => $('loading').classList.add('done'), 120);
  setTimeout(() => $('loading').remove(), 900);
  requestAnimationFrame(frame);
}

/* ---------- title UI ---------- */
function buildTitleUI(){
  const ps = $('paintSeg'); ps.innerHTML = '';
  const nameEl = document.createElement('span'); nameEl.className = 'pname';
  Object.entries(TR.Tex.PAINTS).forEach(([k, p]) => {
    const b = document.createElement('button'); b.dataset.v = k; b.setAttribute('aria-label', p.name);
    b.style.background = `linear-gradient(135deg, ${p.base} 55%, ${p.accent} 55%)`;
    b.setAttribute('aria-pressed', k === settings.paint ? 'true' : 'false');
    ps.appendChild(b);
  });
  ps.appendChild(nameEl); nameEl.textContent = TR.Tex.PAINTS[settings.paint].name;
  ps.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    ps.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
    settings.paint = b.dataset.v; nameEl.textContent = TR.Tex.PAINTS[b.dataset.v].name; save('tr_ultra_settings', settings);
    Md.setPaint(car, settings.paint); AU.init(); AU.sfx('select'); titleSpin = 1.2;
  });
  segGroup('modeSeg', v => { S.players = +v; });
  segGroup('diffSeg', v => { S.diffKey = v; S.diff = DIFF[v]; showBest(); });
  segGroup('qualSeg', v => { settings.quality = v; save('tr_ultra_settings', settings); qualityKey = v === 'auto' ? (isTouch() ? 'mid' : 'high') : v; applyQuality(); }, settings.quality);
  $('musicVol').value = Math.round(settings.music * 100); $('sfxVol').value = Math.round(settings.sfx * 100);
  $('guideChk').checked = settings.guide; $('motionChk').checked = settings.motion;
  $('musicVol').oninput = e => { settings.music = e.target.value / 100; AU.setMusicVol(settings.music); save('tr_ultra_settings', settings); };
  $('sfxVol').oninput = e => { settings.sfx = e.target.value / 100; AU.setSfxVol(settings.sfx); save('tr_ultra_settings', settings); };
  $('guideChk').onchange = e => { settings.guide = e.target.checked; save('tr_ultra_settings', settings); };
  $('motionChk').onchange = e => { settings.motion = e.target.checked; save('tr_ultra_settings', settings); };
  AU.setMusicVol(settings.music); AU.setSfxVol(settings.sfx);
  // hint the right control scheme
  if (isTouch()) $('howto').open = false;
}
function segGroup(id, cb, initial){
  const box = $(id);
  if (initial) box.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x.dataset.v === initial ? 'true' : 'false'));
  box.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    box.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
    cb(b.dataset.v); AU.init(); AU.sfx('click');
  });
}
function showBest(){ const b = bestOf(S.diffKey); $('bestLine').textContent = b ? 'BEST（' + DIFF[S.diffKey].label + '）  ' + b.toLocaleString() : ''; }

/* ---------- screens ---------- */
function showScreen(id){ ['title', 'pause', 'result'].forEach(s => $(s).hidden = s !== id); }
let titleT = 0, titleSpin = 0;
function goTitle(){
  S.mode = 'title'; W.runwayOnly(S.diff); FX.clear(); FX.setWeather(0);
  $('hud').hidden = true; $('touch').hidden = true; document.body.classList.remove('touch-on');
  showScreen('title'); showBest();
  S.x = 0; S.y = 0; S.z = 0; S.vx = S.vy = 0; S.speed = 0; S.grounded = true; S.fold = 0; S.roll = 0; S.rolling = false;
  car.visible = true; car.position.set(0, 0, 0); car.userData.inner.rotation.set(0, 0, 0);
  AU.setMode('title'); AU.setZone(0);
  setTimeout(() => $('startBtn').focus({ preventScroll: true }), 60);
}

function startRun(){
  W.reset(S.diff); FX.clear();
  Object.assign(S, {
    x: 0, y: 0, z: 0, vx: 0, vy: 0, speed: 0, air: 100, grounded: true, lives: S.diff.lives, refBase: 0, coyote: 0,
    score: 0, dist: 0, rings: 0, perfects: 0, rolls: 0, nearMiss: 0, maxAir: 0, airTime: 0, combo: 0, comboT: 0, maxMult: 1,
    crashT: 0, invuln: 0, lastG: 1, roll: 0, rollDir: 0, rolling: false, steerHold: 0, flightRings: 0, fold: 0, thrustNow: 0, boostNow: false,
    zone: 0, missionsDone: {}, hints: {}, lastReason: '', shake: 0, slowmo: 0, timeScale: 1, scrapeT: 0, bigAirs: 0, lastSlope: 0, emptyWarned: false, predKind: -1,
  });
  S.countdown = runs++ ? 2.0 : 3.2; S.lightStep = -1;
  W.ensure(0); W.setZoneBlend(0); FX.setWeather(0);
  car.visible = true; car.position.set(0, 0, 0); car.userData.inner.rotation.set(0, 0, 0);
  camPos.set(0, 3.2, -10); camLook.set(0, 1, 8);
  input.kL = input.kR = input.kT = input.kB = input.tT = input.tB = false; input.tSteer = 0;
  lifeIcons();
  const tag = $('ptag'); if (S.players > 1){ tag.hidden = false; tag.textContent = 'PLAYER ' + (S.cur + 1); } else tag.hidden = true;
  showScreen(null); $('hud').hidden = false;
  const touch = isTouch(); $('touch').hidden = !touch; document.body.classList.toggle('touch-on', touch);
  $('hint').classList.remove('on'); $('toast').classList.remove('on'); $('radar').className = 'radar';
  $('lights').hidden = false; $('lights').querySelectorAll('i').forEach(i => i.classList.remove('on'));
  S.mode = 'play';
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  AU.setMode('play'); AU.setZone(0); AU.setTempoBoost(0);
}
let runs = 0;

function lifeIcons(){ const el = $('lives'); el.innerHTML = ''; for (let i = 0; i < S.diff.lives; i++){ const b = document.createElement('i'); if (i >= S.lives) b.className = 'off'; el.appendChild(b); } }

/* ---------- messaging ---------- */
let toastT = 0, toastPri = 0, hintT = 0;
function toast(big, small = '', dur = 1.2, cls = '', pri = 1){
  if (toastT > .3 && pri < toastPri) return;
  toastPri = pri; toastT = dur;
  const t = $('toast'); $('toastBig').textContent = big; $('toastSmall').textContent = small;
  t.className = 'toast ' + cls; t.style.setProperty('--d', dur + 's'); void t.offsetWidth; t.classList.add('on');
}
function hint(html, dur = 3.5){ const h = $('hint'); h.innerHTML = html; h.classList.add('on'); hintT = dur; }
function once(k, fn){ if (!S.hints[k]){ S.hints[k] = 1; fn(); } }
function flash(strength = .7){ if (settings.motion) return; const f = $('flash'); f.style.transition = 'none'; f.style.opacity = strength; requestAnimationFrame(() => requestAnimationFrame(() => { f.style.transition = 'opacity .6s'; f.style.opacity = 0; })); }
function pulse(){ if (settings.motion) return; const p = $('pulse'); p.style.transition = 'none'; p.style.opacity = .5; requestAnimationFrame(() => { p.style.transition = 'opacity .5s'; p.style.opacity = 0; }); }
function vibrate(p){ try { if (navigator.vibrate) navigator.vibrate(p); } catch(e){} }
function popup(text, cls = ''){
  tmpV.set(S.x, S.y + 2.2, S.z).project(camera);
  const el = document.createElement('div'); el.className = 'pop ' + cls; el.textContent = text;
  el.style.left = ((tmpV.x * .5 + .5) * innerWidth + rand(-30, 30)) + 'px'; el.style.top = ((-tmpV.y * .5 + .5) * innerHeight) + 'px';
  $('popups').appendChild(el); setTimeout(() => el.remove(), 1000);
}
function mult(){ return Math.min(4, 1 + S.combo * .15); }
function addScore(base, label, cls){
  const m = mult(); const pts = Math.round(base * m); S.score += pts;
  if (label) popup('+' + pts + (m > 1 ? '  ×' + m.toFixed(1) : ''), cls);
  const sc = $('score'); sc.classList.remove('bump'); void sc.offsetWidth; sc.classList.add('bump');
  return pts;
}
function comboUp(){ S.combo++; S.comboT = 6; S.maxMult = Math.max(S.maxMult, mult()); if (S.combo > 1) AU.sfx('combo', S.combo); }
function comboBreak(){ if (S.combo >= 3) toast('COMBO END', '×' + mult().toFixed(1) + ' で終了', .9, '', 0); S.combo = 0; S.comboT = 0; }

/* ---------- crash / respawn / end ---------- */
function crash(reason){
  if (S.crashT > 0 || S.invuln > 0) return;
  S.lastReason = reason; S.lives--; lifeIcons();
  S.crashT = 1.9; S.shake = 1.4; S.slowmo = .7; comboBreak();
  AU.sfx('crash'); flash(.85); vibrate([80, 50, 160]);
  FX.explosion(S.x, S.y, S.z, S.speed, TR.Tex.PAINTS[settings.paint].base);
  car.visible = false;
  toast(reason, S.lives > 0 ? 'のこり ' + S.lives + ' 台' : 'ラストマシン大破…', 1.6, 'warn', 3);
}
function respawn(){
  let z = S.z + 8, found = false;
  for (const s of W.segs){
    if (s.type !== 'flat' || s.z1 < z + 20) continue;
    for (let zz = Math.max(s.z0 + 4, z); zz < s.z1 - 16; zz += 4){
      if (s.obst.every(o => Math.abs(o.z - zz) > 22)){ z = zz; found = true; break; }
    }
    if (found) break;
  }
  const f = W.floorAt(z, 0);
  S.z = z; S.x = 0; S.y = f ? f.h : 0; S.refBase = S.y; S.vy = 0; S.vx = 0; S.grounded = true; S.fold = 0;
  S.air = Math.max(S.air, 70); S.invuln = 2.4; S.roll = 0; S.rolling = false; S.speed *= .7;
  camPos.set(S.x, S.y + 3.2, S.z - 10);
  car.visible = true; hint('<b>リスタート</b> — 少しの間は無敵です', 2);
}
function endRun(){
  S.mode = 'result'; AU.setMode('off'); setAudio(0, 0, false, true, false);
  $('hud').hidden = true; $('touch').hidden = true; FX.setGuide(false);
  const total = Math.round(S.score), best = bestOf(S.diffKey), isBest = total > best;
  if (isBest){ setBest(S.diffKey, total); setTimeout(() => AU.sfx('fanfare'), 300); }
  S.results[S.cur] = total;
  const r = S.lastReason;
  let tip = r.includes('落下') ? '谷の手前で噴射を長押し。空中では着地点ガイドが緑になるまで噴射で調整しよう。'
    : r.includes('トラック') ? 'トラックの壁は、少し手前から長押しで高く跳ぶ。上空ではバレルロールのチャンス!'
    : r.includes('車') ? '前方の車は早めに車線変更。すぐ横をすり抜けるとニアミスボーナス。'
    : r.includes('壁') ? '「上り」の谷は高さが必要。手前から長押しで、ガイドが緑になるまで上昇。'
    : '着地の直前に短く噴射すると衝撃が和らいでパーフェクト着地に。';
  if (best > 0 && !isBest) tip += ' 自己ベストまであと ' + (best - total + 1).toLocaleString() + ' 点。';
  $('debrief').textContent = tip;
  const rows = [
    ['走行距離', Math.round(S.dist).toLocaleString() + ' m'], ['到達ゾーン', W.ZONES[S.zone].jp],
    ['リング', S.rings + ' 個'], ['パーフェクト着地', S.perfects + ' 回'], ['ニアミス', S.nearMiss + ' 回'],
    ['バレルロール', S.rolls + ' 回'], ['最長滞空', S.maxAir.toFixed(1) + ' 秒'], ['最大コンボ倍率', '×' + S.maxMult.toFixed(1)],
  ];
  $('resStats').innerHTML = rows.map(([a, b]) => '<dt>' + a + '</dt><dd>' + b + '</dd>').join('') +
    '<dt class="total">スコア</dt><dd class="total">' + total.toLocaleString() + '</dd>' +
    (isBest ? '<dt class="newbest">自己ベスト更新!</dt><dd class="newbest">' + S.diff.label + '</dd>' : '<dt>ベスト（' + S.diff.label + '）</dt><dd>' + best.toLocaleString() + '</dd>');
  const k = S.diffKey === 'easy' ? .7 : S.diffKey === 'hard' ? 1.3 : 1;
  const g = total >= 26000 * k ? 'S' : total >= 13000 * k ? 'A' : total >= 5000 * k ? 'B' : 'C';
  const ge = $('grade'); ge.textContent = g; ge.className = 'grade ' + g; void ge.offsetWidth;
  const rank = $('rank'); rank.hidden = true;
  if (S.players > 1){
    const last = S.cur === S.players - 1;
    $('resEyebrow').textContent = 'PLAYER ' + (S.cur + 1) + ' RESULT';
    if (last){
      $('resTitle').textContent = '最終順位';
      const order = S.results.map((s, i) => ({ s, i })).sort((a, b) => b.s - a.s);
      rank.innerHTML = order.map((o, j) => '<li><span class="pos">' + (j + 1) + '</span><span>プレイヤー ' + (o.i + 1) + (j === 0 ? ' の勝ち!' : '') + '</span><span class="pts">' + o.s.toLocaleString() + '</span></li>').join('');
      rank.hidden = false; $('nextBtn').querySelector('span').textContent = 'もう一度みんなで'; AU.sfx('fanfare');
    } else {
      $('resTitle').textContent = '次はプレイヤー ' + (S.cur + 2) + ' の番!';
      $('nextBtn').querySelector('span').textContent = 'プレイヤー ' + (S.cur + 2) + ' 発進';
    }
  } else {
    $('resEyebrow').textContent = 'RUN COMPLETE';
    $('resTitle').textContent = g === 'S' ? '伝説のスカイドライバー' : g === 'A' ? 'エースパイロット' : g === 'B' ? 'いいフライト!' : 'まずは浮くところから';
    $('nextBtn').querySelector('span').textContent = 'もう一度、飛ぶ';
  }
  showScreen('result'); setTimeout(() => $('nextBtn').focus({ preventScroll: true }), 80);
}

/* ---------- missions ---------- */
const MISSIONS = [
  ['初フライト', '1秒以上 滞空する', () => S.maxAir, 1],
  ['光をつなぐ', 'リングを10個', () => S.rings, 10],
  ['ソフトタッチ', 'パーフェクト着地 ×2', () => S.perfects, 2],
  ['すり抜け名人', 'ニアミス ×3', () => S.nearMiss, 3],
  ['空の曲芸', 'バレルロール ×1', () => S.rolls, 1],
  ['ネオンの街へ', '900m 到達', () => S.dist, 900],
  ['コンボ職人', 'コンボ倍率 ×2.0', () => S.maxMult, 2],
  ['オーロラを見に', '1800m 到達', () => S.dist, 1800],
];
function checkMissions(){
  let active = null, done = 0;
  for (let i = 0; i < MISSIONS.length; i++){
    const m = MISSIONS[i];
    if (S.missionsDone[i]){ done++; continue; }
    if (m[2]() >= m[3]){ S.missionsDone[i] = true; done++; S.score += 300; AU.sfx('milestone'); pulse(); hint('MISSION CLEAR · <b>' + m[0] + '</b>  +300', 2.6); continue; }
    if (!active) active = m;
  }
  const el = $('mission');
  if (active){ const v = active[2](); el.innerHTML = '<b>MISSION ' + (done + 1) + '/' + MISSIONS.length + '</b>' + active[0] + ' · ' + active[1] + '（' + (active[3] >= 100 ? Math.floor(v) + '/' + active[3] : (Math.floor(v * 10) / 10) + '/' + active[3]) + '）'; }
  else el.innerHTML = '<b>ALL CLEAR</b>自己ベストの、その先へ';
}

/* ---------- landing prediction ---------- */
const predPts = Array.from({ length: 40 }, () => new THREE.Vector3()), predList = [];
const predLand = new THREE.Vector3();
function predict(){
  let x = S.x, y = S.y, z = S.z, vy = S.vy, vx = S.vx;
  const dt = 1 / 30, sp = S.speed; predList.length = 0;
  let kind = 2, land = null;
  for (let i = 0; i < 120; i++){
    const py = y;
    vy -= PH.G * dt; y += vy * dt; z += sp * dt; vx *= .9; x = clamp(x + vx * dt, -W.HALF_W + PH.CAR_HW, W.HALF_W - PH.CAR_HW);
    if (i % 2 === 0 && predList.length < 40) predList.push(predPts[predList.length].set(x, y + .4, z));
    const f = W.floorAt(z, x);
    if (f && y <= f.h){
      land = predLand.set(x, f.h, z);
      if (py < f.h - .6) kind = 2; else { const imp = -vy; kind = imp > PH.CRASH_V ? 2 : imp > PH.HARD_V ? 1 : 0; }
      break;
    }
    if (y < S.refBase - 26) break;
  }
  if (!predList.length) predList.push(predPts[0].set(x, y, z));
  return { kind, land };
}

/* ---------- update ---------- */
const camPos = new THREE.Vector3(0, 3, -10), camLook = new THREE.Vector3();
let radarState = '';
function setRadar(text, cls){
  const key = text + cls; if (key === radarState) return; radarState = key;
  const r = $('radar'); r.textContent = text; r.className = 'radar' + (text ? ' on ' + cls : '');
}

function step(dt){
  const D = S.diff, Mt = Md.mats();
  W.update(dt, S.z, S.speed);
  if (S.mode !== 'play') return;

  /* countdown with race lights */
  if (S.countdown > 0){
    S.countdown -= dt;
    const total = runs <= 1 ? 3.2 : 2.0;
    const stepIdx = Math.min(3, Math.floor((total - S.countdown) / ((total - .4) / 3)));
    if (stepIdx !== S.lightStep && S.countdown > 0){
      S.lightStep = stepIdx; const L = $('lights').querySelectorAll('i');
      if (stepIdx < 3){ L[stepIdx].classList.add('on'); AU.sfx('beep', 0); }
    }
    if (S.countdown <= 0){
      const L = $('lights').querySelectorAll('i'); L.forEach(i => i.classList.remove('on')); L[3].classList.add('on');
      AU.sfx('beep', 1); toast('GO!', '', .8, 'gold', 3);
      setTimeout(() => { $('lights').hidden = true; }, 600);
      once('start', () => hint(isTouch() ? '右下の<b>噴射</b>をタップでジャンプ、長押しで上昇。左側を<b>左右にスライド</b>でハンドル' : '<kbd>Space</kbd> でジャンプ、長押しで上昇。<kbd>←</kbd><kbd>→</kbd> でハンドル', 4.5));
    }
    placeCar(dt); camFollow(dt); hud();
    setAudio(0, 0, false, true, true);
    return;
  }

  /* crashed: wait, then respawn */
  if (S.crashT > 0){
    S.crashT -= dt; S.speed *= Math.pow(.4, dt);
    if (S.crashT <= 0){ if (S.lives <= 0){ endRun(); return; } respawn(); }
    camFollow(dt); hud(); FX.setGuide(false);
    setAudio(0, 0, false, true, false);
    return;
  }
  if (S.invuln > 0) S.invuln -= dt;
  if (S.comboT > 0){ S.comboT -= dt; if (S.comboT <= 0) comboBreak(); }

  /* speed & boost */
  const boosting = input.boost && S.air > 0.5;
  if (boosting) S.air = Math.max(0, S.air - PH.BOOST_DRAIN * dt);
  const target = W.speedAt(S.z) * (boosting ? PH.BOOST : 1);
  S.speed = damp(S.speed, target, S.speed < target ? (boosting ? 2.6 : 1.2) : 1.0, dt);
  S.boostNow = boosting;

  /* steering (screen-right = -x) */
  const lat = PH.LAT + S.speed * .04;
  const tvx = -input.steer * lat;
  S.vx = damp(S.vx, tvx, S.grounded ? 13 : 8, dt);
  S.x += S.vx * dt;
  const lim = W.HALF_W - PH.CAR_HW - .12;
  if (Math.abs(S.x) > lim){
    const side = Math.sign(S.x); S.x = side * lim;
    if (Math.abs(S.vx) > 3 && S.grounded){ S.scrapeT -= dt; if (S.scrapeT <= 0){ S.scrapeT = .07; AU.sfx('scrape', 0, { pan: -side * .8 }); FX.sparks(S.x + side * PH.CAR_HW, S.y + .4, S.z, S.speed * .6, 4, -side); } S.speed *= Math.pow(.92, dt); }
    S.vx = 0;
  }

  /* thrust */
  const pressed = input.thrust && !input.prevThrust;
  let thrust = 0;
  if (input.thrust && S.air > 0){
    thrust = 1;
    if (!S.grounded) S.air = Math.max(0, S.air - D.drain * dt);
  }
  if (input.thrust && S.air <= 0 && !S.emptyWarned){ S.emptyWarned = true; AU.sfx('empty'); toast('AIR 切れ!', '地上を走るとコンプレッサーで回復', 1.2, 'warn', 2); }
  if (S.air > 25) S.emptyWarned = false;

  const prevY = S.y;
  S.z += S.speed * dt; S.dist = Math.max(S.dist, S.z);
  const fl = W.floorAt(S.z, S.x);

  if (S.grounded){
    if (!fl || fl.h < S.y - .35){
      // drove off an edge (or off the ramp lip)
      S.grounded = false; S.airTime = 0; S.flightRings = 0; S.coyote = fl ? 0 : PH.COYOTE;
      if (S.lastSlope > 0) { AU.sfx('jump'); once('rampTip', () => hint('ジャンプ台！ 空中で<b>長押し</b>するとさらに伸びる', 2.5)); }
    } else {
      S.y = fl.h; S.vy = S.speed * fl.slope; S.refBase = fl.seg.base; S.lastSlope = fl.slope;
      if (!boosting) S.air = Math.min(100, S.air + D.recharge * dt);
      if (pressed && S.air > 0){
        S.grounded = false; S.vy = Math.max(S.vy, PH.JUMP); S.air = Math.max(0, S.air - PH.JUMP_COST);
        S.airTime = 0; S.flightRings = 0; S.coyote = 0;
        AU.sfx('jump'); FX.groundDust(S.x, S.y, S.z, S.speed * .4);
        for (const w of car.userData.wheels){ car.localToWorld(tmpV.copy(w.pivot.position)); for (let k = 0; k < 6; k++) FX.jet(tmpV.x, tmpV.y, tmpV.z, 0, -rand(8, 14), S.speed * .5); }
      }
    }
  }
  if (!S.grounded){
    if (S.coyote > 0){ S.coyote -= dt; if (pressed && S.air > 0){ S.vy = Math.max(S.vy, PH.JUMP * .9); S.coyote = 0; AU.sfx('jump'); } }
    let acc = -PH.G;
    if (thrust){
      const h = S.y - S.refBase;
      const ceil = 1 - clamp((h - PH.CEIL0) / (PH.CEIL1 - PH.CEIL0), 0, 1);
      acc += PH.THRUST * ceil;
      if (S.vy < -2.5) acc += PH.CUSHION;   // strong retro-burn when falling: easy soft landings
    }
    S.vy = Math.min(PH.VYMAX, S.vy + acc * dt);
    S.y += S.vy * dt; S.airTime += dt; S.maxAir = Math.max(S.maxAir, S.airTime);
    const f2 = W.floorAt(S.z, S.x);
    if (f2 && S.y <= f2.h){
      if (prevY < f2.h - .6){ crash('壁に激突!'); }
      else land(f2);
    } else if (S.y < S.refBase - 24){ crash('谷へ落下!'); }

    // barrel roll: hold steer in the air
    if (!S.rolling && S.y - S.refBase > 3.2 && S.airTime > .3){
      if (Math.abs(input.steer) > .85){ S.steerHold += dt; if (S.steerHold > .2){ S.rolling = true; S.roll = 0; S.rollDir = Math.sign(input.steer); AU.sfx('roll'); } }
      else S.steerHold = 0;
    }
  }
  if (S.rolling){
    S.roll += dt * Math.PI * 2 / .62;
    if (S.roll >= Math.PI * 2){ S.rolling = false; S.roll = 0; S.rolls++; S.steerHold = -.4; comboUp(); addScore(300, true, 'cyan'); toast('バレルロール!', 'AERIAL TRICK', .9, 'gold', 1); }
  }

  /* pickups & obstacles */
  for (const s of W.segs){
    if (s.z1 < S.z - 14 || s.z0 > S.z + 14) continue;
    for (const r of s.rings){
      if (r.got) continue;
      if (Math.abs(S.z - r.z) < 1.2 + S.speed * dt && Math.hypot(S.x - r.x, S.y + .55 - r.y) < 2.1){
        r.got = true; r.mesh.visible = false; S.rings++; S.flightRings = S.grounded ? 1 : S.flightRings + 1;
        const chain = Math.min(S.flightRings, 11);
        addScore(100 + (chain - 1) * 50, true, chain > 2 ? 'cyan' : '');
        if (chain >= 3) comboUp();
        AU.sfx('ring', chain - 1, { pan: clamp(-(r.x - S.x) / 6, -.7, .7) });
        FX.ringBurst(r.x, r.y, r.z, S.speed * .6, chain > 2); pulse();
        if (chain >= 3) toast('リング ×' + chain, '空中で続けて取るほど高得点', .8, 'gold', 0);
      }
    }
    for (const c of s.cells){
      if (c.got) continue;
      if (Math.abs(S.z - c.z) < 1.6 + S.speed * dt && Math.abs(S.x - c.x) < 1.6 && Math.abs(S.y + .5 - c.mesh.position.y) < 1.8){
        c.got = true; c.mesh.visible = false; S.air = Math.min(100, S.air + 35); AU.sfx('cell'); FX.cellBurst(c.x, c.mesh.position.y, c.z, S.speed * .6);
        addScore(50, true, 'cyan'); popup('AIR +35%', 'cyan');
      }
    }
    for (const o of s.obst){
      const dz = Math.abs(S.z - o.z), reach = PH.CAR_HL + o.l / 2;
      if (dz < reach){
        const dx = Math.abs(S.x - o.x) - (PH.CAR_HW + o.w / 2);
        const above = S.y - (o.base + o.h);
        if (dx < 0 && above < -.1 && S.invuln <= 0){ crash(o.truck ? 'トラックに激突!' : '車に衝突!'); break; }
        const clear = dx >= 0 ? dx : (above >= -.1 ? above : 99);
        o.minClear = Math.min(o.minClear === undefined ? 99 : o.minClear, clear);
      } else if (!o.passed && S.z - o.z > reach){
        o.passed = true;
        if (o.minClear !== undefined && o.minClear < .85 && S.crashT <= 0){
          S.nearMiss++; comboUp(); addScore(120, true); AU.sfx('nearmiss', 0, { pan: clamp((o.x - S.x) * -.3, -.8, .8) });
          toast(o.truck && o.minClear >= 0 && S.y > o.base + o.h - .2 ? 'ギリギリ通過!' : 'ニアミス!', 'NEAR MISS', .7, '', 0); vibrate(20);
        }
      }
    }
  }

  /* tutorial / contextual hints */
  if (!S.grounded && S.y - S.refBase > 2) once('air1', () => hint('空中では<b>着地点ガイド</b>が出ます。<b>緑</b>なら安全、<b>赤</b>なら噴射で調整!', 3.5));
  if (S.dist > 260) once('boost', () => hint(isTouch() ? '<b>BOOST</b>ボタンでAIRを使って加速。長い谷で使おう' : '<kbd>Shift</kbd> でブースト。AIRを使って加速、長い谷で使おう', 3.5));
  if (S.dist > 520) once('roll', () => hint('高く飛んだら<b>ハンドルを倒し続けて</b>バレルロール! +300', 3.5));

  /* zone & milestones */
  const zi = W.zoneIndexAt(S.z);
  if (zi !== S.zone && S.z > 100){
    S.zone = zi; const Z = W.ZONES[zi]; AU.sfx('zone'); AU.setZone(zi); FX.setWeather(zi);
    toast(Z.jp, 'ZONE ' + (Math.floor(S.z / W.ZONE_LEN) + 1) + ' · ' + Z.name + ' · SPEED UP', 2.2, 'gold', 2);
    addScore(500, true);
  }
  AU.setTempoBoost(Math.min(24, Math.floor(S.dist / 600) * 4));
  S.score += S.speed * dt * .6;

  /* world streaming */
  W.ensure(S.z);

  /* emitters */
  S.thrustNow = thrust;
  placeCar(dt);
  const inner = car.userData.inner;
  if (thrust){
    for (const w of car.userData.wheels){
      w.pivot.getWorldPosition(tmpV);
      FX.jet(tmpV.x, tmpV.y - .2, tmpV.z, S.vx * .5, -rand(14, 22), S.speed * rand(.5, .75));
    }
    const f = W.floorAt(S.z, S.x);
    if (f && S.y - f.h < 4.5) FX.groundDust(S.x, f.h, S.z, S.speed * .7, zi === 2 ? [.85, .9, 1] : zi === 1 ? [.4, .4, .5] : [.8, .6, .5]);
  }
  if (boosting){
    for (const b of car.userData.boosts){ b.flame.getWorldPosition(tmpV); FX.boostFlame(tmpV.x, tmpV.y, tmpV.z, S.speed * .4 - 12); }
  }

  /* guide */
  if (!S.grounded && settings.guide){
    const p = predict(); FX.setGuide(true, predList, p.land, p.kind); S.predKind = p.kind;
  } else { FX.setGuide(false); S.predKind = -1; }

  /* radar warnings */
  radar();

  camFollow(dt);
  setAudio(S.speed, thrust, boosting, S.grounded, true);
  hud();
  checkMissionsThrottled(dt);
}
let missionClock = 0;
function checkMissionsThrottled(dt){ missionClock -= dt; if (missionClock <= 0){ missionClock = .25; checkMissions(); } }

function land(f){
  const impact = -S.vy, g = 1 + impact / 6;
  S.lastG = g; S.y = f.h; S.grounded = true; S.refBase = f.seg.base;
  const at = S.airTime; S.vy = 0;
  if (impact > PH.CRASH_V){ crash('激突! ' + g.toFixed(1) + 'G'); return; }
  const rollInc = S.rolling; if (S.rolling){ S.rolling = false; S.roll = 0; }
  const k = clamp(impact / PH.CRASH_V, 0, 1);
  AU.sfx('land', k); S.shake = Math.max(S.shake, k * .9); landKick = settings.motion ? 0 : Math.min(.35, impact * .02);
  FX.groundDust(S.x, f.h, S.z, S.speed * .5); FX.groundDust(S.x, f.h, S.z, S.speed * .5);
  if (at > .55){
    if (rollInc){ toast('着地失敗', 'ロールが間に合わなかった', 1, 'warn', 1); comboBreak(); S.speed *= .8; FX.touchdown(S.x, f.h, S.z, false); vibrate(40); }
    else if (impact < PH.PERFECT_V){
      S.perfects++; comboUp(); const pts = addScore(250, true, 'cyan'); AU.sfx('perfect'); pulse(); FX.touchdown(S.x, f.h, S.z, true); vibrate(15);
      toast('パーフェクト着地!', g.toFixed(1) + 'G · SOFT TOUCHDOWN', 1.2, '', 2);
    } else if (impact > PH.HARD_V){
      AU.sfx('hard'); comboBreak(); S.speed *= .82; FX.touchdown(S.x, f.h, S.z, false); vibrate(50);
      toast('ハード着地 ' + g.toFixed(1) + 'G', '着地の直前に噴射で衝撃をやわらげよう', 1.3, 'warn', 2);
    } else FX.touchdown(S.x, f.h, S.z, false);
    if (at > 2.4){ S.bigAirs = (S.bigAirs || 0) + 1; addScore(200, true); toast('ビッグエア!', at.toFixed(1) + '秒 滞空', 1, 'gold', 1); }
  }
  S.airTime = 0;
}

function radar(){
  let txt = '', cls = '';
  const lookT = S.speed * 2.4;
  const gap = W.segs.find(s => s.type === 'gap' && s.z0 > S.z && s.z0 - S.z < lookT);
  if (!S.grounded && S.predKind === 2 && S.vy < 0) { txt = '↓ このままだと危険 — 噴射で調整!'; cls = 'danger'; }
  else if (!S.grounded && S.predKind === 1 && S.vy < -3) { txt = '↓ 着地前に短く噴射'; cls = ''; }
  else if (!S.grounded && S.predKind === 0 && S.vy < -2) { txt = '✓ 着地OK'; cls = 'good'; }
  else if (gap && S.grounded){
    const d = Math.ceil(gap.z0 - S.z), up = gap.base > gap.takeoffBase + .5;
    txt = '▲ 谷まで ' + d + 'm' + (up ? ' · 上り!' : '') + (d < S.speed * .7 ? ' — 今だ、噴射!' : ''); cls = d < S.speed * .7 ? 'danger' : '';
  } else if (S.grounded){
    let ob = null;
    for (const s of W.segs){ if (s.z0 > S.z + S.speed * 2) break; for (const o of s.obst){ if (o.z > S.z && o.z - S.z < S.speed * 1.6 && (o.truck || Math.abs(o.x - S.x) < 2.2)){ ob = o; break; } } if (ob) break; }
    if (ob){ txt = ob.truck ? '■ トラックの壁 — 跳び越えろ!' : '◆ 前方に車 — 車線変更!'; cls = ob.truck ? 'danger' : ''; }
    else if (S.air < 22){ txt = 'AIR LOW — 地上で回復中'; cls = ''; }
  }
  setRadar(txt, cls);
}

/* ---------- car pose ---------- */
let landKick = 0;
function placeCar(dt){
  const U = car.userData, inner = U.inner;
  car.position.set(S.x, S.y, S.z);
  const fl = S.grounded ? W.floorAt(S.z, S.x) : null;
  const pitch = S.grounded ? -Math.atan((fl || { slope: 0 }).slope) : clamp(-S.vy * .03, -.4, .35);
  inner.rotation.x = damp(inner.rotation.x, pitch, 10, dt);
  const bank = S.grounded ? S.vx * .012 : -S.vx * .045;
  inner.rotation.z = damp(inner.rotation.z, bank, 8, dt);
  const rollAng = S.rolling ? S.roll * S.rollDir : 0;
  inner.rotation.y = S.vx * .022;
  inner.position.y = S.grounded ? Math.sin(performance.now() * .05) * .006 * (S.speed / 40) : 0;
  car.rotation.z = rollAng;
  // hover-fold wheels
  const wantFold = !S.grounded && S.airTime > .1 ? 1 : 0;
  S.fold = damp(S.fold, wantFold, wantFold ? 7 : 16, dt);
  const thrusting = S.thrustNow ? 1 : 0;
  for (const w of U.wheels){
    w.pivot.rotation.z = -w.side * S.fold * Math.PI / 2;
    w.spin.rotation.x += (S.grounded ? S.speed : S.speed * .3 + 10 * S.fold) * dt / .36;
    w.jet.rotation.z = -w.pivot.rotation.z; w.jet.rotation.x = 0;
    const pw = Math.max(thrusting, S.fold * .18);
    w.jet.material.uniforms.power.value = pw;
    w.jet.scale.set(1, .35 + pw * (thrusting ? .9 + Math.random() * .25 : .5), 1);
    w.jet.visible = pw > .02;
    if (w.glowRing) w.glowRing.material.opacity = S.fold;
  }
  for (const b of U.boosts){ const p = S.boostNow ? 1 : .0; b.flame.material.uniforms.power.value = p; b.flame.scale.set(1, .6 + p * (.8 + Math.random() * .3), 1); b.flame.visible = p > 0; }
  U.under.intensity = thrusting ? 7 : S.fold * 1.8;
  car.visible = S.crashT > 0 ? false : (S.invuln > 0 ? Math.floor(performance.now() / 80) % 2 === 0 : true);
}

/* ---------- camera ---------- */
let camRoll = 0;
function camFollow(dt){
  const air = S.grounded ? 0 : clamp(S.y - S.refBase, 0, 12);
  const back = 7.4 + S.speed * .05 + air * .18 - (S.boostNow ? .8 : 0);
  const height = 2.7 + air * .34 + (S.grounded ? 0 : .6);
  tmpV.set(S.x * .78, S.y + height, S.z - back);
  camPos.x = damp(camPos.x, tmpV.x, 6, dt); camPos.y = damp(camPos.y, tmpV.y, 4.5, dt); camPos.z = damp(camPos.z, tmpV.z, 12, dt);
  camera.position.copy(camPos);
  landKick = damp(landKick, 0, 9, dt); camera.position.y -= landKick;
  if (settings.motion) S.shake = 0;
  if (S.shake > 0){ S.shake = Math.max(0, S.shake - dt * 2.4); const k = S.shake * S.shake * .5; camera.position.x += rand(-1, 1) * k; camera.position.y += rand(-1, 1) * k; }
  if (!settings.motion && S.grounded && S.speed > 35) camera.position.y += Math.sin(performance.now() * .07) * .012 * (S.speed - 35) / 15;
  const lookAhead = 10 + S.speed * .18 + (S.grounded ? 0 : 4);
  tmpV2.set(S.x * .9, S.y + 1.1 - (S.grounded ? 0 : air * .25), S.z + lookAhead);
  camLook.x = damp(camLook.x, tmpV2.x, 8, dt); camLook.y = damp(camLook.y, tmpV2.y, 6, dt); camLook.z = tmpV2.z;
  camera.lookAt(camLook);
  camRoll = damp(camRoll, settings.motion ? 0 : S.vx * .009, 5, dt); camera.rotateZ(camRoll);
  const fov = baseFov + clamp(S.speed - 22, 0, 30) * .42 + (S.boostNow ? 9 : 0) + (S.thrustNow && !S.grounded ? 2 : 0);
  camera.fov = damp(camera.fov, fov, 3, dt); camera.updateProjectionMatrix();
  followEnv();
}
function followEnv(){
  W.sky.position.copy(camera.position);
  const sun = W.sun, Z = W.ZONES[W.zoneIndexAt(S.z)];
  const sd = tmpV.set(Z.sunDir[0], Math.max(Z.sunDir[1], .5), Z.sunDir[2]).normalize();
  sun.position.set(S.x + sd.x * 60, S.y + sd.y * 60, S.z + 8 + sd.z * 60); sun.target.position.set(S.x, S.y, S.z + 8); sun.target.updateMatrixWorld();
  W.setZoneBlend(S.mode === 'title' ? 0 : S.z);
}

/* ---------- title showroom ---------- */
function titleUpdate(dt){
  titleT += dt; titleSpin = Math.max(0, titleSpin - dt);
  W.update(dt, 0, 0);
  const cycle = titleT % 9, hover = cycle > 5 && cycle < 8.2;
  S.grounded = !hover; S.thrustNow = hover ? 1 : 0; S.airTime = hover ? 1 : 0;
  const targetY = hover ? 1.5 + Math.sin(titleT * 2) * .15 : 0;
  S.y = damp(S.y, targetY, hover ? 2.5 : 5, dt); S.vy = 0; S.vx = Math.sin(titleT * .7) * .4; S.speed = 0;
  placeCar(dt);
  car.userData.inner.rotation.y = Math.sin(titleT * .5) * .12 + titleSpin * 2;
  if (hover) for (const w of car.userData.wheels){ w.pivot.getWorldPosition(tmpV); FX.jet(tmpV.x, tmpV.y - .2, tmpV.z, 0, -rand(9, 13), rand(-.5, .5)); if (Math.random() < .5) FX.groundDust(tmpV.x, 0, tmpV.z, 0); }
  const a = titleT * .16 + 2.2, narrow = innerWidth < 760, r = narrow ? 10.5 : 7.6;
  camera.position.set(Math.cos(a) * r, 2.1 + Math.sin(titleT * .3) * .4, Math.sin(a) * r);
  // shift the car to the right third on wide screens (menu card sits on the left)
  const fwd = tmpV2.set(-camera.position.x, 0, -camera.position.z).normalize();
  const right = tmpV.crossVectors(fwd, camera.up).normalize().multiplyScalar(narrow ? 0 : -2.6);
  camera.lookAt(right.x, narrow ? -3.6 : .9, right.z); // narrow: car sits above the bottom-sheet menu
  camera.fov = damp(camera.fov, baseFov - 6, 2, dt); camera.updateProjectionMatrix();
  followEnv();
  setAudio(0, S.thrustNow, false, true, true, true);
}
// audio parameters are pushed at most ~30 times per second
const audioState = { speed: 0, thrust: 0, boost: false, grounded: true, playing: false, title: false, combo: 0 };
let audioClock = 0;
function setAudio(speed, thrust, boost, grounded, playing, title = false){
  audioState.speed = speed; audioState.thrust = thrust; audioState.boost = boost; audioState.grounded = grounded; audioState.playing = playing; audioState.title = title; audioState.combo = S.combo;
}

/* ---------- HUD ---------- */
let hudClock = 0;
function hud(){
  if (++hudClock % 3) return;
  $('score').textContent = Math.round(S.score).toLocaleString();
  $('dist').textContent = Math.round(S.dist).toLocaleString() + ' m';
  const kmh = Math.round(S.speed * 3.6);
  $('spd').textContent = kmh; $('spdArc').style.strokeDasharray = (clamp(kmh / 220, 0, 1) * 75) + ' 100';
  let g = 1; for (const t of [9, 17, 25, 33, 42]) if (S.speed > t) g++;
  $('gear').textContent = S.grounded ? 'G' + g : 'HOVER';
  const a = clamp(S.air, 0, 100);
  $('airPct').textContent = Math.round(a); $('airArc').style.strokeDasharray = (a / 100 * 75) + ' 100';
  $('airGauge').classList.toggle('low', a < 22); $('airGauge').classList.toggle('boosting', S.boostNow);
  $('alt').textContent = 'ALT ' + Math.max(0, S.y - S.refBase).toFixed(1) + 'm';
  $('thrRing').style.strokeDasharray = a + ' 100';
  const m = mult(); $('comboX').textContent = '×' + m.toFixed(1); $('combo').classList.toggle('on', S.combo > 0); $('comboBar').style.width = (S.comboT / 6 * 100) + '%';
  const local = S.z % W.ZONE_LEN, zi = W.zoneIndexAt(S.z);
  $('zoneName').textContent = W.ZONES[zi].name; $('zoneFill').style.width = (local / W.ZONE_LEN * 100) + '%';
  $('zoneNext').textContent = Math.ceil((W.ZONE_LEN - local)) + 'm';
  $('lowAir').classList.toggle('on', a < 20 && !S.grounded && !settings.motion);
  $('boostVeil').style.opacity = S.boostNow ? 1 : 0;
}

/* ---------- frame loop ---------- */
let lastT = performance.now(), acc = 0, perfAcc = 0, perfN = 0, perfWarm = 0;
function frame(now){
  requestAnimationFrame(frame);
  let rdt = Math.min(.1, (now - lastT) / 1000); lastT = now;
  // slow motion on crash
  if (S.slowmo > 0){ S.slowmo -= rdt; S.timeScale = .28; } else S.timeScale = damp(S.timeScale, 1, 4, rdt);
  const dt = rdt * S.timeScale;
  pollGamepad(); combineInput();
  if (S.mode === 'play' && !TR.game.manual){
    acc += dt; let n = 0;
    while (acc >= 1 / 120 && n < 16){ step(1 / 120); acc -= 1 / 120; n++; input.prevThrust = input.thrust; }
  } else if (S.mode === 'title'){ titleUpdate(rdt); acc = 0; }
  audioClock -= rdt; if (audioClock <= 0){ audioClock = 1 / 30; AU.update(audioState); }
  if (toastT > 0) toastT -= rdt;
  if (hintT > 0){ hintT -= rdt; if (hintT <= 0) $('hint').classList.remove('on'); }
  if (S.mode !== 'paused'){ FX.update(dt, camera.position, S.mode === 'play' ? S.speed : 0, S.boostNow && S.mode === 'play'); }
  // post fx
  const U = finalPass.uniforms;
  U.time.value = now * .001; U.exposure.value = renderer.toneMappingExposure;
  const spd = S.mode === 'play' ? S.speed : 0;
  U.blur.value = settings.motion ? 0 : damp(U.blur.value, (S.boostNow ? 1 : 0) + clamp((spd - 34) / 30, 0, .5), 5, rdt);
  U.aberr.value = damp(U.aberr.value, settings.motion ? 0 : (S.boostNow ? 1 : 0) + (S.crashT > 0 ? 2 : 0), 6, rdt);
  U.sat.value = damp(U.sat.value, S.crashT > 0 ? .25 : 1.1, 4, rdt);
  bloom.strength = W.zoneIndexAt(S.z) === 1 && S.mode === 'play' ? .85 : .62;
  composer.render(rdt);
  // adaptive quality
  if (S.mode === 'play' && settings.quality === 'auto' && S.countdown <= 0){
    perfWarm += rdt; if (perfWarm > 3){ perfAcc += rdt; perfN++; if (perfN >= 120){ const avg = perfAcc / perfN; perfAcc = 0; perfN = 0;
      if (avg > 1 / 38 && qualityKey !== 'low'){ qualityKey = qualityKey === 'high' ? 'mid' : 'low'; applyQuality(); hint('なめらかさ優先で<b>画質を自動調整</b>しました', 2.2); perfWarm = 0; } } }
  }
}

/* ---------- input ---------- */
const KEY = { ArrowLeft: 'kL', KeyA: 'kL', ArrowRight: 'kR', KeyD: 'kR', Space: 'kT', ArrowUp: 'kT', KeyW: 'kT', ShiftLeft: 'kB', ShiftRight: 'kB', KeyX: 'kB', ArrowDown: 'kB', KeyS: 'kB' };
addEventListener('keydown', e => {
  if (KEY[e.code] && S.mode === 'play'){ input[KEY[e.code]] = true; e.preventDefault(); }
  if (!e.repeat && (e.code === 'KeyP' || e.code === 'Escape') && (S.mode === 'play' || S.mode === 'paused')) togglePause();
  if ((e.code === 'Enter' || e.code === 'Space') && S.mode === 'title' && document.activeElement === document.body){ e.preventDefault(); $('startBtn').click(); }
  if (e.code === 'KeyM' && !e.repeat){ $('muteBtn').click(); }
});
addEventListener('keyup', e => { if (KEY[e.code]) input[KEY[e.code]] = false; });
addEventListener('blur', () => { releaseAll(); if (S.mode === 'play') togglePause(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && S.mode === 'play') togglePause(); });
function releaseAll(){ input.kL = input.kR = input.kT = input.kB = input.tT = input.tB = false; input.tSteer = 0; touches.clear(); $('stick').hidden = true; document.querySelectorAll('.tbtn.down').forEach(b => b.classList.remove('down')); }

let padPrevStart = false;
function pollGamepad(){
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  input.pSteer = 0; input.pT = false; input.pB = false;
  for (const p of pads){
    if (!p) continue;
    let ax = p.axes[0] || 0; if (Math.abs(ax) < .15) ax = 0;
    const b = i => p.buttons[i] && p.buttons[i].pressed;
    if (b(14)) ax = -1; if (b(15)) ax = 1;
    input.pSteer = ax; input.pT = b(0) || b(1) || b(12); input.pB = b(7) || b(5) || b(2);
    const start = b(9);
    if (start && !padPrevStart){ if (S.mode === 'play' || S.mode === 'paused') togglePause(); else if (S.mode === 'title') $('startBtn').click(); else if (S.mode === 'result') $('nextBtn').click(); }
    padPrevStart = start;
    if (S.mode === 'title' && b(0) && !padPrevA){ $('startBtn').click(); }
    padPrevA = b(0);
    break;
  }
}
let padPrevA = false;
function combineInput(){
  const k = (input.kR ? 1 : 0) - (input.kL ? 1 : 0);
  input.steer = clamp(k + input.tSteer + input.pSteer, -1, 1);
  input.thrust = input.kT || input.tT || input.pT;
  input.boost = input.kB || input.tB || input.pB;
}

/* touch: left side = horizontal slide stick, right side = thrust, boost button */
const touches = new Map();
const touchEl = $('touch'), stick = $('stick'), knob = $('knob');
touchEl.addEventListener('pointerdown', e => {
  if (S.mode !== 'play') return;
  e.preventDefault(); AU.init();
  const tgt = e.target.closest('#boostBtn') ? 'boost' : (e.clientX < innerWidth * .48 && !e.target.closest('#thrustBtn')) ? 'steer' : 'thrust';
  touches.set(e.pointerId, { kind: tgt, x0: e.clientX, y0: e.clientY });
  try { touchEl.setPointerCapture(e.pointerId); } catch(_){}
  if (tgt === 'steer'){ stick.hidden = false; stick.style.left = e.clientX + 'px'; stick.style.top = e.clientY + 'px'; knob.style.transform = 'translateX(0)'; touchEl.classList.add('used'); }
  else if (tgt === 'boost'){ input.tB = true; $('boostBtn').classList.add('down'); }
  else { input.tT = true; $('thrustBtn').classList.add('down'); }
}, { passive: false });
touchEl.addEventListener('pointermove', e => {
  const t = touches.get(e.pointerId); if (!t || t.kind !== 'steer') return;
  let dx = e.clientX - t.x0; const R = 58;
  if (Math.abs(dx) > R){ t.x0 += dx - Math.sign(dx) * R; stick.style.left = t.x0 + 'px'; dx = Math.sign(dx) * R; } // stick follows the thumb
  input.tSteer = clamp(dx / (R * .8), -1, 1);
  knob.style.transform = 'translateX(' + dx * .8 + 'px)';
});
function touchEnd(e){
  const t = touches.get(e.pointerId); if (!t) return; touches.delete(e.pointerId);
  if (t.kind === 'steer'){ input.tSteer = 0; stick.hidden = true; }
  else if (t.kind === 'boost'){ input.tB = [...touches.values()].some(v => v.kind === 'boost'); if (!input.tB) $('boostBtn').classList.remove('down'); }
  else { input.tT = [...touches.values()].some(v => v.kind === 'thrust'); if (!input.tT) $('thrustBtn').classList.remove('down'); }
}
['pointerup', 'pointercancel', 'lostpointercapture'].forEach(ev => touchEl.addEventListener(ev, touchEnd));
touchEl.addEventListener('contextmenu', e => e.preventDefault());

/* ---------- buttons ---------- */
$('startBtn').addEventListener('click', () => { AU.init(); AU.sfx('select'); S.cur = 0; S.results = []; startRun(); });
$('nextBtn').addEventListener('click', () => { AU.init(); AU.sfx('select'); if (S.players > 1){ if (S.cur < S.players - 1) S.cur++; else { S.cur = 0; S.results = []; } } startRun(); });
$('homeBtn').addEventListener('click', () => { AU.sfx('click'); goTitle(); });
$('quitBtn').addEventListener('click', () => { AU.sfx('click'); goTitle(); });
$('restartBtn').addEventListener('click', () => { AU.sfx('click'); startRun(); });
$('resumeBtn').addEventListener('click', togglePause);
$('pauseBtn').addEventListener('click', togglePause);
$('muteBtn').addEventListener('click', () => { AU.init(); AU.setMute(!AU.muted); $('muteBtn').classList.toggle('off', AU.muted); });
function togglePause(){
  if (S.mode === 'play'){ releaseAll(); S.mode = 'paused'; showScreen('pause'); AU.setMode('off'); setAudio(0, 0, false, true, false); setTimeout(() => $('resumeBtn').focus({ preventScroll: true }), 50); }
  else if (S.mode === 'paused'){ S.mode = 'play'; showScreen(null); AU.setMode('play'); lastT = performance.now(); }
}
// unlock audio on first gesture anywhere
addEventListener('pointerdown', () => { AU.init(); if (S.mode === 'title') AU.setMode('title'); }, { once: true });
addEventListener('keydown', () => { AU.init(); if (S.mode === 'title') AU.setMode('title'); }, { once: true });

/* debug / test hooks */
TR.game = { S, input, startRun, goTitle, step, predict, combineInput, manual: false, get car(){ return car; } };

resize();
boot();
})();
