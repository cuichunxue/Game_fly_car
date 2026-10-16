/* ============================================================
 * Thrust Roadster — audio engine (100% Web Audio synthesis)
 * エンジン・噴射・風・効果音・アダプティブBGMをリアルタイム合成
 * ============================================================ */
window.TR = window.TR || {};
TR.Audio = (() => {
  'use strict';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

  const A = {
    ctx: null, muted: false, musicVol: .6, sfxVol: .8,
    mode: 'off', zone: 0, intensity: 1, airborne: false, step: 0, nextT: 0, timer: 0,
  };

  function init(){
    if (A.ctx){ if (A.ctx.state === 'suspended') A.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const ctx = A.ctx = new AC({ latencyHint: 'interactive' });
    A.master = ctx.createGain(); A.master.gain.value = A.muted ? 0 : .9;
    const lim = ctx.createDynamicsCompressor(); lim.threshold.value = -8; lim.knee.value = 6; lim.ratio.value = 10; lim.attack.value = .003; lim.release.value = .2;
    A.master.connect(lim); lim.connect(ctx.destination);

    // reverb (generated impulse response)
    A.verb = ctx.createConvolver(); A.verb.buffer = impulse(ctx, 2.6, 2.8);
    A.verbIn = ctx.createGain(); A.verbIn.gain.value = 1; A.verbIn.connect(A.verb);
    const verbOut = ctx.createGain(); verbOut.gain.value = .55; A.verb.connect(verbOut); verbOut.connect(A.master);
    // ping-pong delay
    A.delayIn = ctx.createGain();
    const dl = ctx.createDelay(1), dr = ctx.createDelay(1), fb = ctx.createGain(), pl = ctx.createStereoPanner(), pr = ctx.createStereoPanner(), dlp = ctx.createBiquadFilter();
    dl.delayTime.value = .3; dr.delayTime.value = .3; fb.gain.value = .38; pl.pan.value = -.7; pr.pan.value = .7; dlp.type = 'lowpass'; dlp.frequency.value = 3500;
    A.delayIn.connect(dl); dl.connect(pl); dl.connect(dr); dr.connect(pr); dr.connect(dlp); dlp.connect(fb); fb.connect(dl);
    const dOut = ctx.createGain(); dOut.gain.value = .5; pl.connect(dOut); pr.connect(dOut); dOut.connect(A.master); dOut.connect(A.verbIn);
    A.delays = [dl, dr];

    A.sfxBus = ctx.createGain(); A.sfxBus.gain.value = A.sfxVol; A.sfxBus.connect(A.master);
    A.musicBus = ctx.createGain(); A.musicBus.gain.value = 0;
    A.musicLP = ctx.createBiquadFilter(); A.musicLP.type = 'lowpass'; A.musicLP.frequency.value = 18000; A.musicLP.Q.value = .8;
    A.musicBus.connect(A.musicLP); A.musicLP.connect(A.master);
    A.duck = ctx.createGain(); A.duck.connect(A.musicBus); // sidechain-ducked bus (pads, bass)
    A.drums = ctx.createGain(); A.drums.connect(A.musicBus);

    // noise buffers
    A.white = noiseBuf(ctx, 'white'); A.brown = noiseBuf(ctx, 'brown');

    buildEngine(ctx);
    A.nextT = ctx.currentTime + .1;
    A.timer = setInterval(schedule, 25);
  }

  function impulse(ctx, dur, decay){
    const len = ctx.sampleRate * dur | 0, b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++){
      const d = b.getChannelData(c);
      for (let i = 0; i < len; i++){
        const t = i / len; let v = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
        if (i < ctx.sampleRate * .08 && Math.random() < .004) v *= 6; // early reflections
        d[i] = v * (c ? .95 : 1);
      }
    }
    return b;
  }
  function noiseBuf(ctx, kind){
    const len = ctx.sampleRate * 3, b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++){
      const d = b.getChannelData(c); let last = 0;
      for (let i = 0; i < len; i++){
        const w = Math.random() * 2 - 1;
        if (kind === 'brown'){ last = (last + .02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
      }
    }
    return b;
  }
  function loopNoise(buf){ const s = A.ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(0, Math.random() * 2); return s; }
  function gain(v, to){ const g = A.ctx.createGain(); g.gain.value = v; if (to) g.connect(to); return g; }
  function filt(type, f, q, to){ const b = A.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; if (q !== undefined) b.Q.value = q; if (to) b.connect(to); return b; }
  function osc(type, f, to){ const o = A.ctx.createOscillator(); o.type = type; o.frequency.value = f; if (to) o.connect(to); o.start(); return o; }

  /* ---------- continuous layers: engine, turbine, thrust, boost, wind, tires ---------- */
  function buildEngine(ctx){
    const E = A.E = {};
    // engine core
    E.out = gain(0, A.sfxBus);
    const shaper = ctx.createWaveShaper(); const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++){ const x = i / 512 - 1; curve[i] = Math.tanh(x * 2.4); } shaper.curve = curve;
    E.lp = filt('lowpass', 600, 2.2, E.out);
    shaper.connect(E.lp);
    E.am = gain(1, shaper);
    E.o1 = osc('sawtooth', 60, E.am); E.o2 = osc('sawtooth', 60.4, E.am); E.o3 = osc('square', 30, gain(.6, E.am));
    // combustion pulse (AM)
    E.lfo = osc('sine', 30); E.lfoDepth = gain(.35, E.am.gain); E.lfo.connect(E.lfoDepth);
    // turbine whine (hover mode)
    E.turb = gain(0, A.sfxBus);
    E.t1 = osc('sine', 900, E.turb); E.t2 = osc('triangle', 1803, gain(.3, E.turb));
    // thrust jets: band + rumble + crackle
    E.thr = gain(0, A.sfxBus);
    const n1 = loopNoise(A.white); E.thrBP = filt('bandpass', 1200, .7); n1.connect(E.thrBP); E.thrBP.connect(E.thr);
    E.rum = gain(0, A.sfxBus); const n2 = loopNoise(A.brown); const rlp = filt('lowpass', 160, 1); n2.connect(rlp); rlp.connect(E.rum);
    // boost afterburner
    E.boost = gain(0, A.sfxBus);
    const n3 = loopNoise(A.white); E.boostBP = filt('bandpass', 700, .9); n3.connect(E.boostBP); E.boostBP.connect(E.boost);
    E.bo = osc('sawtooth', 48, filt('lowpass', 220, 4, gain(.5, E.boost)));
    // wind
    E.wind = gain(0, A.sfxBus); const n4 = loopNoise(A.white); E.windLP = filt('lowpass', 600, .3); n4.connect(E.windLP);
    const wp = ctx.createStereoPanner(); E.windLP.connect(wp); wp.connect(E.wind);
    E.windPan = osc('sine', .13); const wpd = gain(.5, wp.pan); E.windPan.connect(wpd);
    // tires
    E.tire = gain(0, A.sfxBus); const n5 = loopNoise(A.brown); E.tireLP = filt('lowpass', 300, .7); n5.connect(E.tireLP); E.tireLP.connect(E.tire);
    E.rpm = 900; E.gear = 1; E.prevThrust = false; E.prevBoost = false;
  }

  const GEARS = [0, 9, 17, 25, 33, 42, 99]; // m/s gear thresholds
  function update(s){
    if (!A.ctx || !A.E) return;
    const E = A.E, t = A.ctx.currentTime, on = s.playing ? 1 : 0;
    // rpm with gear shifts
    let g = 1; while (g < GEARS.length - 1 && s.speed > GEARS[g]) g++;
    const lo = GEARS[g - 1], hi = GEARS[g]; let k = clamp((s.speed - lo) / (hi - lo), 0, 1);
    let rpm = 1800 + k * 4600 + (g - 1) * 180;
    if (!s.grounded) rpm = 3200 + s.thrust * 2200;
    if (s.boost) rpm += 900;
    if (g !== E.gear && s.grounded && s.playing){ if (g > E.gear) shiftSound(); E.gear = g; }
    E.rpm += (rpm - E.rpm) * .25;
    const f = E.rpm / 60;
    E.o1.frequency.setTargetAtTime(f, t, .03); E.o2.frequency.setTargetAtTime(f * 1.007, t, .03); E.o3.frequency.setTargetAtTime(f / 2, t, .03);
    E.lfo.frequency.setTargetAtTime(f / 2, t, .03);
    E.lp.frequency.setTargetAtTime(300 + E.rpm * .22 + (s.boost ? 900 : 0), t, .05);
    E.out.gain.setTargetAtTime(on * (s.grounded ? .13 : .06) * (s.title ? .6 : 1), t, .08);
    // turbine
    E.turb.gain.setTargetAtTime(on * ((s.grounded ? 0 : .025) + s.thrust * .03), t, .1);
    E.t1.frequency.setTargetAtTime(700 + s.thrust * 700 + s.speed * 8, t, .1); E.t2.frequency.setTargetAtTime(1400 + s.thrust * 1500 + s.speed * 17, t, .1);
    // thrust
    E.thr.gain.setTargetAtTime(on * s.thrust * .34, t, .025); E.rum.gain.setTargetAtTime(on * s.thrust * .85, t, .03);
    E.thrBP.frequency.setTargetAtTime(900 + s.thrust * 1400 + Math.random() * 500, t, .02);
    if (s.playing && s.thrust && !E.prevThrust) ignite();
    if (s.playing && !s.thrust && E.prevThrust) release();
    E.prevThrust = !!(s.playing && s.thrust);
    // boost
    E.boost.gain.setTargetAtTime(on * (s.boost ? .36 : 0), t, s.boost ? .05 : .2);
    E.boostBP.frequency.setTargetAtTime(500 + Math.random() * 400, t, .02);
    if (s.playing && s.boost && !E.prevBoost) sfx('boost');
    E.prevBoost = !!(s.playing && s.boost);
    // wind & tires
    const sp = clamp(s.speed / 55, 0, 1.3);
    E.wind.gain.setTargetAtTime(on * (sp * sp * (s.grounded ? .09 : .2)) + (s.title ? .02 : 0), t, .2);
    E.windLP.frequency.setTargetAtTime(400 + sp * 1600 + (s.grounded ? 0 : 900), t, .2);
    E.tire.gain.setTargetAtTime(on * (s.grounded ? sp * .3 : 0), t, .05);
    E.tireLP.frequency.setTargetAtTime(200 + sp * 500, t, .1);
    // music reacts to flight
    A.airborne = !s.grounded && s.playing;
    A.musicLP.frequency.setTargetAtTime(A.mode === 'play' ? (A.airborne ? 2600 : 18000) : (A.mode === 'title' ? 5000 : 900), t, A.airborne ? .25 : .08);
    A.intensity = s.combo >= 3 || s.boost ? 2 : 1;
  }
  function ignite(){ const t = A.ctx.currentTime; tone(70, t, .2, 'sine', .4, 160); noiseHit(t, .16, .35, 1800, 'bandpass', 1.2); noiseHit(t, .05, .25, 5000, 'highpass'); }
  function release(){ const t = A.ctx.currentTime; noiseHit(t, .35, .12, 3500, 'highpass', 0, 1200); }
  function shiftSound(){ const t = A.ctx.currentTime; A.E.am.gain.setValueAtTime(.35, t); A.E.am.gain.linearRampToValueAtTime(1, t + .12); noiseHit(t, .1, .06, 800, 'bandpass'); }

  /* ---------- one-shot helpers ---------- */
  function tone(f, t, dur, type, vol, f2, opts = {}){
    const ctx = A.ctx; const o = ctx.createOscillator(), g = ctx.createGain(); o.type = type || 'sine';
    o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur * (opts.glide || 1));
    if (opts.detune) o.detune.value = opts.detune;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + (opts.att || .006)); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    let node = g;
    if (opts.pan){ const p = ctx.createStereoPanner(); p.pan.value = opts.pan; g.connect(p); node = p; }
    o.connect(g); node.connect(opts.bus || A.sfxBus);
    if (opts.verb){ const s = gain(opts.verb, A.verbIn); node.connect(s); }
    if (opts.delay){ const s = gain(opts.delay, A.delayIn); node.connect(s); }
    o.start(t); o.stop(t + dur + .05); return o;
  }
  function noiseHit(t, dur, vol, freq, type, q, freq2, opts = {}){
    const ctx = A.ctx; const s = ctx.createBufferSource(); s.buffer = opts.brown ? A.brown : A.white;
    const f = ctx.createBiquadFilter(); f.type = type || 'lowpass'; f.frequency.setValueAtTime(freq, t); if (q) f.Q.value = q;
    if (freq2) f.frequency.exponentialRampToValueAtTime(freq2, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + (opts.att || .004)); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    s.connect(f); f.connect(g);
    let node = g; if (opts.pan !== undefined){ const p = ctx.createStereoPanner(); p.pan.setValueAtTime(opts.pan, t); if (opts.pan2 !== undefined) p.pan.linearRampToValueAtTime(opts.pan2, t + dur); g.connect(p); node = p; }
    node.connect(opts.bus || A.sfxBus); if (opts.verb){ node.connect(gain(opts.verb, A.verbIn)); }
    s.start(t, Math.random() * 2); s.stop(t + dur + .05);
  }
  function bell(f, t, vol, opts = {}){
    tone(f, t, 1.4, 'sine', vol, 0, { verb: .5, delay: .25, pan: opts.pan });
    tone(f * 2.0, t, .8, 'sine', vol * .35, 0, { verb: .4, pan: opts.pan });
    tone(f * 3.01, t, .45, 'sine', vol * .18, 0, { verb: .3 });
    tone(f * .5, t, .3, 'triangle', vol * .3, 0, {});
  }

  const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26];
  function sfx(name, v = 0, opt = {}){
    if (!A.ctx) return; const t = A.ctx.currentTime + .005;
    switch (name){
      case 'jump': tone(110, t, .22, 'sine', .45, 240); noiseHit(t, .22, .3, 500, 'bandpass', 1, 2400); break;
      case 'ring': { const n = PENTA[Math.min(PENTA.length - 1, v)]; bell(mtof(81 + n - 12) , t, .2, { pan: opt.pan || 0 }); noiseHit(t, .12, .08, 7000, 'highpass', 0, 0, { verb: .4 }); break; }
      case 'cell': [0, 7, 12, 19].forEach((n, i) => tone(mtof(76 + n), t + i * .045, .4, 'triangle', .12, 0, { verb: .4 })); noiseHit(t, .5, .2, 1500, 'highpass', 0, 9000); break;
      case 'land': { const k = clamp(v, 0, 1); tone(95, t, .28, 'sine', .55 * (.4 + k), 38); noiseHit(t, .22, .4 * (.3 + k), 380, 'lowpass', 0, 0, { brown: true }); noiseHit(t + .03, .09, .12, 2400, 'bandpass', 3); break; }
      case 'perfect': [0, 4, 7, 11, 14].forEach((n, i) => tone(mtof(72 + n), t + i * .055, 1.1, i % 2 ? 'sine' : 'triangle', .13, 0, { verb: .6, delay: .2 })); noiseHit(t, .6, .12, 800, 'bandpass', 1, 6000, { verb: .3 }); break;
      case 'hard': tone(80, t, .35, 'sine', .7, 30); noiseHit(t, .3, .5, 600, 'lowpass'); [523, 1130, 1764].forEach(f => tone(f, t, .25, 'triangle', .05)); break;
      case 'crash':
        noiseHit(t, 1.6, .9, 4000, 'lowpass', 1, 120, { verb: .5 }); tone(70, t, 1.1, 'sine', .9, 22);
        [431, 977, 1544, 2213].forEach((f, i) => tone(f, t + i * .01, .9, 'triangle', .07, f * .92, { verb: .4 }));
        for (let i = 0; i < 9; i++) noiseHit(t + .1 + Math.random() * .6, .05, .1, 5000 + Math.random() * 4000, 'bandpass', 4);
        break;
      case 'scrape': noiseHit(t, .12, .16, 2600 + Math.random() * 1500, 'bandpass', 2, 0, { pan: opt.pan || 0 }); break;
      case 'nearmiss': noiseHit(t, .5, .5, 2600, 'bandpass', 1.4, 500, { pan: opt.pan || .6, pan2: -(opt.pan || .6) }); tone(880, t + .05, .25, 'triangle', .07, 1320, { verb: .3 }); break;
      case 'roll': noiseHit(t, .6, .3, 400, 'bandpass', 1.2, 3000, { pan: -.6, pan2: .6 }); tone(330, t, .6, 'sine', .1, 990, { verb: .4 }); break;
      case 'combo': tone(mtof(84 + Math.min(12, v * 2)), t, .2, 'square', .05, 0, { delay: .3 }); break;
      case 'beep': tone(v ? 1320 : 660, t, v ? .5 : .18, 'square', .13, 0, { verb: .25 }); if (v) tone(1980, t, .5, 'sine', .08, 0, { verb: .3 }); break;
      case 'empty': tone(196, t, .14, 'square', .1); tone(147, t + .16, .2, 'square', .1); break;
      case 'zone': [0, 7, 12, 16, 19, 24].forEach((n, i) => tone(mtof(57 + n), t + i * .04, 2.2, 'sawtooth', .035, 0, { verb: .7, att: .3 })); tone(55, t, 1.5, 'sine', .6, 40); noiseHit(t, 2, .25, 300, 'lowpass', 1, 6000, { verb: .5 }); break;
      case 'milestone': [0, 5, 9, 12, 17].forEach((n, i) => tone(mtof(72 + n), t + i * .07, .5, 'triangle', .12, 0, { verb: .5 })); break;
      case 'fanfare': [0, 4, 7, 12, 7, 12, 16, 19].forEach((n, i) => tone(mtof(67 + n), t + i * .11, .5, 'square', .07, 0, { verb: .4, delay: .2 })); break;
      case 'click': tone(1800, t, .04, 'square', .05); break;
      case 'select': tone(990, t, .08, 'triangle', .1); tone(1480, t + .05, .1, 'triangle', .08); break;
      case 'boost': noiseHit(t, .7, .45, 300, 'bandpass', 1, 3500); tone(60, t, .6, 'sawtooth', .18, 140); break;
    }
  }

  /* ---------- adaptive synthwave sequencer ---------- */
  const SONGS = [
    { bpm: 118, prog: [[57, [0, 3, 7, 10]], [53, [0, 4, 7, 11]], [60, [0, 4, 7, 14]], [55, [0, 4, 7, 10]]] }, // Am F C G
    { bpm: 126, prog: [[52, [0, 3, 7, 10]], [48, [0, 4, 7, 11]], [55, [0, 4, 7, 14]], [50, [0, 4, 7, 9]]] }, // Em C G D
    { bpm: 110, prog: [[50, [0, 3, 7, 14]], [46, [0, 4, 7, 11]], [53, [0, 4, 7, 9]], [48, [0, 4, 7, 14]]] }, // Dm Bb F C
  ];
  const TITLE = { bpm: 84, prog: [[57, [0, 3, 7, 14]], [53, [0, 4, 7, 11]], [48, [0, 4, 7, 14]], [55, [0, 2, 7, 11]]] };
  let songIdx = 0, pendingZone = 0;
  function voice(type, f, t, dur, vol, out, opts = {}){
    const ctx = A.ctx; const o = ctx.createOscillator(), g = ctx.createGain(); o.type = type; o.frequency.value = f; if (opts.detune) o.detune.value = opts.detune;
    let node = o;
    if (opts.lp){ const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.Q.value = opts.q || 1; fl.frequency.setValueAtTime(opts.lp, t); if (opts.lp2) fl.frequency.exponentialRampToValueAtTime(opts.lp2, t + dur * .9); o.connect(fl); node = fl; }
    const att = opts.att || .005;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + att);
    if (opts.sus){ g.gain.setValueAtTime(vol, t + dur - (opts.rel || .1)); g.gain.linearRampToValueAtTime(0, t + dur); }
    else g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    node.connect(g); g.connect(out);
    if (opts.verb) g.connect(gain(opts.verb, A.verbIn)); if (opts.delay) g.connect(gain(opts.delay, A.delayIn));
    o.start(t); o.stop(t + dur + .05);
  }
  function drum(kind, t){
    const ctx = A.ctx;
    if (kind === 'kick'){
      const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + .14);
      g.gain.setValueAtTime(.95, t); g.gain.exponentialRampToValueAtTime(.0001, t + .32); o.connect(g); g.connect(A.drums); o.start(t); o.stop(t + .35);
      // sidechain pump
      A.duck.gain.cancelScheduledValues(t); A.duck.gain.setValueAtTime(.35, t); A.duck.gain.linearRampToValueAtTime(1, t + .22);
    } else if (kind === 'snare'){
      noiseHit(t, .22, .42, 1900, 'bandpass', .8, 0, { bus: A.drums, verb: .45 });
      const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'triangle'; o.frequency.setValueAtTime(240, t); o.frequency.exponentialRampToValueAtTime(160, t + .1);
      g.gain.setValueAtTime(.3, t); g.gain.exponentialRampToValueAtTime(.0001, t + .12); o.connect(g); g.connect(A.drums); o.start(t); o.stop(t + .15);
    } else if (kind === 'hat'){ noiseHit(t, .035, .09, 8500, 'highpass', 0, 0, { bus: A.drums }); }
    else if (kind === 'ohat'){ noiseHit(t, .16, .07, 7500, 'highpass', 0, 0, { bus: A.drums }); }
  }
  function schedule(){
    const ctx = A.ctx; if (!ctx) return;
    if (A.mode === 'off' || document.hidden){ A.nextT = ctx.currentTime + .08; return; }
    if (A.nextT < ctx.currentTime - .3) A.nextT = ctx.currentTime + .05;
    const song = A.mode === 'title' ? TITLE : SONGS[songIdx];
    const sp = 60 / (song.bpm + (A.mode === 'play' ? A.tempoBoost || 0 : 0)) / 4;
    A.delays.forEach(d => d.delayTime.setTargetAtTime(sp * 3, ctx.currentTime, .1));
    while (A.nextT < ctx.currentTime + .14){
      const st = A.step % 64, beat = st % 16, bar = (st / 16) | 0, t = A.nextT;
      if (beat === 0 && bar === 0 && A.mode === 'play' && pendingZone !== songIdx){ songIdx = pendingZone; }
      const [root, chord] = song.prog[bar];
      const play = A.mode === 'play';
      // pad: chord at bar start
      if (beat === 0){
        chord.forEach((n, i) => {
          const f = mtof(root + 12 + n);
          voice('sawtooth', f, t, sp * 16, .022, A.duck, { detune: -9, lp: play ? 1400 : 900, lp2: play ? 2400 : 1600, att: .35, sus: true, rel: .3, verb: .3 });
          voice('sawtooth', f, t, sp * 16, .022, A.duck, { detune: 9, lp: play ? 1400 : 900, att: .35, sus: true, rel: .3 });
        });
        if (!play) voice('sine', mtof(root - 12), t, sp * 16, .12, A.duck, { att: .5, sus: true, rel: .5 });
      }
      if (play){
        const air = A.airborne;
        if (beat % 4 === 0 && !air) drum('kick', t);
        if (beat === 4 || beat === 12) drum('snare', t);
        if (beat % 2 === 1) drum('hat', t);
        if (beat % 4 === 2) drum('ohat', t);
        if (beat === 14 && bar === 3) drum('snare', t + sp * .5);
        // pumping bass: 8ths with octave jumps
        if (beat % 2 === 0){ const oct = (beat === 6 || beat === 14) ? 12 : 0; voice('sawtooth', mtof(root - 12 + oct), t, sp * 1.8, .16, A.duck, { lp: 700, lp2: 220, q: 6 }); }
        // arp
        if (A.intensity >= 1){ const arp = [0, 1, 2, 3, 2, 1, 2, 3]; const n = chord[arp[beat % 8]] + (beat >= 8 ? 12 : 0); voice('square', mtof(root + 24 + n), t, sp * 1.2, .028, A.musicBus, { lp: 3200, delay: .35 }); }
        // lead hook when hot (combo/boost)
        if (A.intensity >= 2 && [0, 3, 6, 10, 12].includes(beat)){ const n = chord[[0, 1, 2, 3, 2][[0, 3, 6, 10, 12].indexOf(beat)]]; voice('sawtooth', mtof(root + 36 + n), t, sp * 2.4, .035, A.musicBus, { lp: 4200, delay: .35, verb: .3, detune: 6 }); }
      } else {
        // title: sparse bell arp
        if (beat % 4 === 0){ const n = chord[(beat / 4 + bar) % chord.length]; voice('triangle', mtof(root + 24 + n), t, sp * 6, .05, A.musicBus, { delay: .5, verb: .5 }); }
        if (beat === 8 && bar % 2 === 1) drum('ohat', t);
      }
      A.nextT += sp; A.step++;
    }
  }

  function setMode(m){
    if (!A.ctx){ A.mode = m; return; }
    if (m === 'play' && A.mode !== 'play'){ A.step = 0; songIdx = pendingZone; }
    if (m === 'title' && A.mode !== 'title') A.step = 0;
    A.mode = m;
    const t = A.ctx.currentTime;
    A.musicBus.gain.setTargetAtTime(m === 'off' ? 0 : A.musicVol * (m === 'title' ? .7 : .55), t, .4);
  }
  function setZone(z){ pendingZone = z % SONGS.length; }
  function setTempoBoost(b){ A.tempoBoost = b; }
  function setMusicVol(v){ A.musicVol = v; if (A.ctx) setMode(A.mode); }
  function setSfxVol(v){ A.sfxVol = v; if (A.ctx) A.sfxBus.gain.setTargetAtTime(v, A.ctx.currentTime, .05); }
  function setMute(m){ A.muted = m; if (A.ctx) A.master.gain.setTargetAtTime(m ? 0 : .9, A.ctx.currentTime, .05); }
  function silenceLoops(){ if (A.ctx) update({ speed: 0, thrust: 0, boost: false, grounded: true, playing: false }); }

  return { init, update, sfx, setMode, setZone, setTempoBoost, setMusicVol, setSfxVol, setMute, silenceLoops, get muted(){ return A.muted; }, get ready(){ return !!A.ctx; } };
})();
