/* ============================================================
 * Thrust Roadster — world: sky, zones, lighting, track, scenery
 * ============================================================ */
window.TR = window.TR || {};
TR.World = (() => {
  'use strict';
  const Md = TR.Models, T = TR.Tex;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = a => a[(Math.random() * a.length) | 0];
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

  const HALF_W = 6, GROUND_Y = -46, ZONE_LEN = 900, TILE = 120;
  const LANES = [-3.6, 0, 3.6];

  /* ---------- zones ---------- */
  const ZONES = [
    { key: 'canyon', name: 'SUNSET CANYON', jp: '夕焼けキャニオン',
      top: 0x10183d, mid: 0x6d3a78, hor: 0xffa565, sunCol: 0xffb36b, sunDir: [-.38, .07, 1], sunSize: 1.4, stars: .2, aurora: 0, clouds: 1, moon: 0,
      fog: 0x9a5a6e, fogNear: 110, fogFar: 720, hemiSky: 0xffc09a, hemiGround: 0x4a2430, hemiI: .55, dirCol: 0xffc48a, dirI: 2.0, exposure: .82 },
    { key: 'city', name: 'NEON METROPOLIS', jp: 'ネオン・メトロポリス',
      top: 0x030310, mid: 0x170a36, hor: 0xb02a78, sunCol: 0x000000, sunDir: [.3, .2, 1], sunSize: 1, stars: .45, aurora: 0, clouds: .45, moon: 1,
      fog: 0x1c0c2c, fogNear: 80, fogFar: 600, hemiSky: 0x8a6cff, hemiGround: 0x301030, hemiI: .45, dirCol: 0x9fb4ff, dirI: .8, exposure: .95 },
    { key: 'glacier', name: 'AURORA GLACIER', jp: 'オーロラ氷河',
      top: 0x01040c, mid: 0x07203a, hor: 0x2d8aa0, sunCol: 0x000000, sunDir: [0, .2, 1], sunSize: 1, stars: 1, aurora: 1, clouds: 0, moon: .8,
      fog: 0x0a2032, fogNear: 100, fogFar: 680, hemiSky: 0x9fdcff, hemiGround: 0x1a3550, hemiI: .45, dirCol: 0xbfe6ff, dirI: .9, exposure: .78 },
  ];
  const zoneIndexAt = z => Math.floor(Math.max(0, z) / ZONE_LEN) % ZONES.length;

  let scene, renderer, sky, skyMat, hemi, sun, fill, envMaps = [], segs = [], tiles = [], buildZ = 0, segCount = 0, tileZ = -TILE * 2;
  const trackGroup = new THREE.Group(), sceneryGroup = new THREE.Group();
  const dynamic = { vehicles: [], beacons: [], cells: [], rings: [], flyers: [] };
  let diff = null, rng = Math.random;

  /* ---------- sky ---------- */
  function makeSky(){
    skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        top: { value: new THREE.Color() }, mid: { value: new THREE.Color() }, hor: { value: new THREE.Color() }, sunCol: { value: new THREE.Color() },
        sunDir: { value: new THREE.Vector3(0, .1, 1).normalize() }, moonDir: { value: new THREE.Vector3(-.45, .38, 1).normalize() },
        sunSize: { value: 1 }, stars: { value: 0 }, aurora: { value: 0 }, clouds: { value: 0 }, moon: { value: 0 }, time: { value: 0 },
      },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.); gl_Position = p.xyww; }',
      fragmentShader: `
        uniform vec3 top, mid, hor, sunCol, sunDir, moonDir; uniform float sunSize, stars, aurora, clouds, moon, time;
        varying vec3 vDir;
        float hash(vec3 p){ p = fract(p*.3183099+.1); p *= 17.; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
        float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
        float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
          return mix(mix(h2(i), h2(i+vec2(1,0)), f.x), mix(h2(i+vec2(0,1)), h2(i+vec2(1,1)), f.x), f.y); }
        float fbm(vec2 p){ float s = 0., a = .5; for(int i=0;i<5;i++){ s += a*n2(p); p *= 2.03; a *= .5; } return s; }
        void main(){
          vec3 d = normalize(vDir); float h = d.y;
          vec3 c = mix(hor, mid, smoothstep(-.03, .2, h));
          c = mix(c, top, smoothstep(.2, .8, h));
          c = mix(c, hor*.35, smoothstep(0., -.25, h));
          // sun
          float sd = max(dot(d, normalize(sunDir)), 0.);
          c += sunCol * (smoothstep(.9994 - .0004*sunSize, .9998, sd)*8. + pow(sd, 22.)*.55 + pow(sd, 5.)*.18);
          // moon
          float md = dot(d, normalize(moonDir));
          float disc = smoothstep(.99955, .9997, md);
          float crater = .82 + .18*n2(d.xy*900.);
          c += moon * (vec3(.85,.9,1.)*disc*2.2*crater + vec3(.4,.5,.8)*pow(max(md,0.),60.)*.35);
          // stars
          vec3 q = d*420.; vec3 id = floor(q); float s = hash(id);
          float star = step(.9965, s) * smoothstep(.5, .1, length(fract(q)-.5)) * smoothstep(.02, .25, h);
          c += vec3(.9,.95,1.) * star * stars * (.55 + .45*sin(time*2.5 + s*80.)) * 1.6;
          // clouds (stratus bands lit by sun)
          if (clouds > 0. && h > -.02){
            vec2 uv = d.xz/(h+.12);
            float cl = fbm(uv*1.4 + vec2(time*.01, 0.));
            float band = smoothstep(.0, .06, h) * smoothstep(.45, .12, h);
            float a = smoothstep(.48, .78, cl) * band * clouds;
            vec3 lit = mix(mid*.7, sunCol*1.4 + hor*.4, pow(sd, 3.)*.9 + .1);
            c = mix(c, lit, a*.85);
          }
          // aurora curtains
          if (aurora > 0. && h > 0.){
            vec2 uv = d.xz/(h+.25);
            float w = sin(uv.x*1.6 + time*.12 + sin(uv.y*1.3 + time*.07)*2.2);
            float curtain = exp(-abs(uv.y*.7 - w*.6 - .9)*2.8);
            float rays = .6 + .4*sin(uv.x*28. + time*.6 + fbm(uv*3.)*6.);
            float a = curtain * rays * smoothstep(.04, .3, h) * smoothstep(1., .45, h);
            vec3 ac = mix(vec3(.15,1.,.6), vec3(.55,.3,1.), smoothstep(.2, .7, h));
            c += ac * a * aurora * 1.1;
          }
          gl_FragColor = vec4(c, 1.);
        }`
    });
    sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), skyMat);
    sky.renderOrder = -10; sky.frustumCulled = false;
    return sky;
  }
  function applyZoneSky(u, Z){
    u.top.value.setHex(Z.top); u.mid.value.setHex(Z.mid); u.hor.value.setHex(Z.hor); u.sunCol.value.setHex(Z.sunCol);
    u.sunDir.value.set(...Z.sunDir).normalize(); u.sunSize.value = Z.sunSize; u.stars.value = Z.stars; u.aurora.value = Z.aurora; u.clouds.value = Z.clouds; u.moon.value = Z.moon;
  }

  function buildEnvMaps(){
    const pm = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    const s = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), skyMat.clone()); envScene.add(s);
    // bright softboxes give crisp reflections on paint
    const panel = (c, x, y, z, w, h) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide })); m.position.set(x, y, z); m.lookAt(0, 0, 0); envScene.add(m); };
    ZONES.forEach((Z, i) => {
      applyZoneSky(s.material.uniforms, Z);
      while (envScene.children.length > 1) envScene.remove(envScene.children[1]);
      if (i === 0){ panel(new THREE.Color(0xffd0a0).multiplyScalar(3), -30, 25, 60, 50, 12); panel(new THREE.Color(0x8090ff).multiplyScalar(.6), 0, 80, -20, 90, 30); }
      if (i === 1){ panel(new THREE.Color(0xff40c0).multiplyScalar(2.5), -60, 10, 30, 30, 40); panel(new THREE.Color(0x40e8ff).multiplyScalar(2.5), 60, 15, -10, 30, 50); panel(new THREE.Color(0xffffff).multiplyScalar(1.2), 0, 90, 0, 60, 20); }
      if (i === 2){ panel(new THREE.Color(0x60ffc0).multiplyScalar(1.5), 0, 60, 60, 120, 20); panel(new THREE.Color(0xc0e8ff).multiplyScalar(1.2), 0, 90, -20, 60, 30); }
      envMaps[i] = pm.fromScene(envScene, .02).texture;
    });
    pm.dispose();
  }

  function init(sc, r){
    scene = sc; renderer = r;
    scene.add(makeSky());
    scene.fog = new THREE.Fog(0x000000, 60, 600);
    hemi = new THREE.HemisphereLight(0xffffff, 0x000000, .8); scene.add(hemi);
    sun = new THREE.DirectionalLight(0xffffff, 2); sun.castShadow = true;
    sun.shadow.camera.left = -22; sun.shadow.camera.right = 22; sun.shadow.camera.top = 22; sun.shadow.camera.bottom = -22;
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 140; sun.shadow.bias = -.0008; sun.shadow.normalBias = .06;
    scene.add(sun); scene.add(sun.target);
    fill = new THREE.DirectionalLight(0x6fa8ff, .35); fill.position.set(30, 20, -60); scene.add(fill);
    scene.add(trackGroup); scene.add(sceneryGroup);
    buildEnvMaps();
    setZoneBlend(0);
  }
  function setShadowSize(n){ sun.castShadow = n > 0; if (n > 0){ sun.shadow.mapSize.set(n, n); if (sun.shadow.map){ sun.shadow.map.dispose(); sun.shadow.map = null; } } }

  const cA = new THREE.Color(), cB = new THREE.Color();
  const lerpHex = (out, a, b, t) => out.setHex(a).lerp(cB.setHex(b), t);
  let currentEnv = -1, zoneInfo = { index: 0, blend: 0 };
  function setZoneBlend(z){
    const zi = zoneIndexAt(z), next = (zi + 1) % ZONES.length;
    const local = Math.max(0, z) % ZONE_LEN; const t = smooth(ZONE_LEN - 170, ZONE_LEN, local);
    const A = ZONES[zi], B = ZONES[next], u = skyMat.uniforms;
    lerpHex(u.top.value, A.top, B.top, t); lerpHex(u.mid.value, A.mid, B.mid, t); lerpHex(u.hor.value, A.hor, B.hor, t); lerpHex(u.sunCol.value, A.sunCol, B.sunCol, t);
    u.sunDir.value.set(...A.sunDir).normalize(); u.sunSize.value = A.sunSize;
    u.stars.value = A.stars + (B.stars - A.stars) * t; u.aurora.value = A.aurora + (B.aurora - A.aurora) * t;
    u.clouds.value = A.clouds + (B.clouds - A.clouds) * t; u.moon.value = A.moon + (B.moon - A.moon) * t;
    lerpHex(scene.fog.color, A.fog, B.fog, t); scene.fog.near = A.fogNear + (B.fogNear - A.fogNear) * t; scene.fog.far = A.fogFar + (B.fogFar - A.fogFar) * t;
    lerpHex(hemi.color, A.hemiSky, B.hemiSky, t); lerpHex(hemi.groundColor, A.hemiGround, B.hemiGround, t); hemi.intensity = A.hemiI + (B.hemiI - A.hemiI) * t;
    lerpHex(sun.color, A.dirCol, B.dirCol, t); sun.intensity = A.dirI + (B.dirI - A.dirI) * t;
    renderer.toneMappingExposure = A.exposure + (B.exposure - A.exposure) * t;
    const envI = t < .5 ? zi : next;
    if (envI !== currentEnv){ currentEnv = envI; scene.environment = envMaps[envI]; }
    zoneInfo.index = zi; zoneInfo.blend = t; zoneInfo.next = next;
    return zoneInfo;
  }

  /* ---------- geometry batcher (merge static parts per material) ---------- */
  class Batch {
    constructor(){ this.map = new Map(); this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.e = new THREE.Euler(); this.s = new THREE.Vector3(); this.p = new THREE.Vector3(); }
    add(geo, mat, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1){
      this.m.compose(this.p.set(x, y, z), this.q.setFromEuler(this.e.set(rx, ry, rz)), this.s.set(sx, sy, sz));
      const g = geo.index ? geo.clone() : geo.clone(); g.applyMatrix4(this.m);
      if (!this.map.has(mat)) this.map.set(mat, []); this.map.get(mat).push(g);
    }
    box(w, h, l, mat, x, y, z, rx = 0){ this.add(UNIT_BOX, mat, x, y, z, rx, 0, 0, w, h, l); }
    build(group, cast = false, receive = true){
      for (const [mat, list] of this.map){
        const merged = THREE.BufferGeometryUtils.mergeBufferGeometries(list); list.forEach(g => g.dispose());
        if (!merged) continue; merged.userData.disposable = true;
        const mesh = new THREE.Mesh(merged, mat); mesh.castShadow = cast; mesh.receiveShadow = receive; group.add(mesh);
      }
      this.map.clear();
    }
  }
  const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
  function roadPlane(len){
    const g = new THREE.PlaneGeometry(HALF_W * 2, len, 1, 1); g.rotateX(-Math.PI / 2);
    const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * len / 12);
    return g;
  }

  /* ---------- track segments ---------- */
  function makeSeg(type, len, opts = {}){
    const z0 = buildZ, z1 = buildZ + len, base = opts.base !== undefined ? opts.base : lastBase();
    const g = new THREE.Group(); trackGroup.add(g);
    const seg = { type, z0, z1, base, h: opts.h || 0, group: g, obst: [], rings: [], cells: [], beacons: [], safe: !!opts.safe, leadsGap: false };
    const Mt = Md.mats(), B = new Batch(), zc = (z0 + z1) / 2;
    if (type === 'flat'){
      const rp = roadPlane(len); B.add(rp, Mt.road, 0, base, zc); rp.dispose();
      B.box(HALF_W * 2 + 1, 1.4, len, Mt.concrete, 0, base - .86, zc);
      for (const s of [-1, 1]){
        B.box(.5, .85, len, Mt.concrete, s * (HALF_W + .25), base + .42, zc);
        B.box(.12, .14, len, Mt.rail, s * (HALF_W + .05), base + .78, zc);
        B.box(.04, .06, len, Mt.railGlow, s * (HALF_W - .02), base + .5, zc);
      }
      for (let zz = z0 + 14; zz < z1 - 6; zz += 34){ B.box(2.6, -GROUND_Y + base, 2.6, Mt.concrete, 0, (GROUND_Y + base) / 2 - .7, zz); B.box(5, 1.2, 3.2, Mt.concrete, 0, base - 1.8, zz); }
      // lamp posts alternate sides
      for (let zz = z0 + 10 + (segCount % 2) * 17; zz < z1 - 4; zz += 34){
        const side = (Math.floor(zz / 34) % 2) ? 1 : -1;
        const lp = Md.lampPost(side); lp.position.set(side * (HALF_W + .7), base, zz); g.add(lp);
      }
    } else if (type === 'ramp'){
      const h = seg.h, L = Math.hypot(len, h), ang = Math.atan2(h, len);
      B.add(UNIT_BOX, Mt.chevron, 0, base + h / 2 - .5 * Math.cos(ang), zc, -ang, 0, 0, HALF_W * 2, 1, L);
      B.box(HALF_W * 2 + 1, h + 1.4, .8, Mt.hazard, 0, base + (h - 1.4) / 2, z1 - .4);
      B.box(HALF_W * 2 + 1, 1.4, len, Mt.concrete, 0, base - .86, zc);
      for (const s of [-1, 1]){
        B.add(UNIT_BOX, Mt.cyanGlow, s * (HALF_W - .1), base + h / 2 + .06, zc, -ang, 0, 0, .14, .1, L);
        B.box(.4, -GROUND_Y + base, .4, Mt.concrete, s * (HALF_W - .5), (GROUND_Y + base) / 2, z1 - 1);
      }
      B.box(2.6, -GROUND_Y + base, 2.6, Mt.concrete, 0, (GROUND_Y + base) / 2 - .7, zc);
    } else if (type === 'gap'){
      // hazard end caps + flashing beacons on both lips
      for (const s of [-1, 1]){
        const b1 = Md.beacon(); b1.position.set(s * (HALF_W - .3), lastBase(), z0 + .3); g.add(b1); seg.beacons.push(b1);
        const b2 = Md.beacon(); b2.position.set(s * (HALF_W - .3), opts.landBase, z1 - .3); g.add(b2); seg.beacons.push(b2);
      }
      B.box(HALF_W * 2 + 1, 1.4, .2, Mt.hazard, 0, lastBase() - .72, z0 + .1);
      B.box(HALF_W * 2 + 1, 1.4, .2, Mt.hazard, 0, opts.landBase - .72, z1 - .1);
      seg.base = opts.landBase; seg.takeoffBase = lastBase();
    }
    B.build(g, false, true);
    segs.push(seg); buildZ = z1; segCount++;
    return seg;
  }
  function lastBase(){ for (let i = segs.length - 1; i >= 0; i--){ return segs[i].base; } return 0; }

  function addRing(seg, x, y, z){
    const r = Md.ring(); r.position.set(x, y, z); seg.group.add(r);
    const o = { mesh: r, x, y, z, got: false, phase: Math.random() * 6 }; seg.rings.push(o); return o;
  }
  function addCell(seg, x, y, z){
    const c = Md.airCell(); c.position.set(x, y, z); seg.group.add(c);
    seg.cells.push({ mesh: c, x, y, z, got: false, phase: Math.random() * 6 });
  }
  function addVehicle(seg, x, z, isTruck, speed){
    const v = isTruck ? Md.truck() : Md.trafficCar();
    v.group.position.set(x, seg.base, z); seg.group.add(v.group);
    const o = { ...v, x, z, base: seg.base, speed, active: false, seg, truck: isTruck, passed: false };
    seg.obst.push(o); return o;
  }
  function addGantry(seg, z, lines, style){ const g = Md.gantry(lines, style); g.position.set(0, seg.base, z); seg.group.add(g); }

  // speed (m/s) used by the generator to size jumps
  function speedAt(z){ const p = clamp(z / 3200, 0, 1); return diff.v0 + (diff.v1 - diff.v0) * p; }

  function generate(){
    if (segCount === 0){ const s = makeSeg('flat', 240, { safe: true, base: 0 }); addRing(s, 0, 2.6, 60); addRing(s, 0, 4.2, 70); addRing(s, 0, 5.4, 80); addCell(s, 3.6, 1, 112); addGantry(s, 128, ['JUMP!', '谷まで 22m · 噴射長押し'], 'amber'); return; }
    if (segCount === 1){ const s = makeSeg('gap', 16, { landBase: 0 }); addRing(s, 0, 5.2, s.z0 + 8); return; }
    if (segCount === 2){ const s = makeSeg('flat', 120, { safe: true }); addCell(s, 0, 1, s.z0 + 30); addVehicle(s, 3.6, s.z0 + 70, false, 10); addRing(s, -3.6, 2.4, s.z0 + 90); addRing(s, -3.6, 3.4, s.z0 + 98); return; }
    const last = segs[segs.length - 1], prog = clamp(buildZ / 3200, 0, 1), v = speedAt(buildZ);
    if (last.type === 'ramp' && last.leadsGap){ gapSeg(v, prog, true); return; }
    if (last.type === 'gap' || last.type === 'ramp'){ flatSeg(rand(48, 70), prog, true); return; }
    const r = Math.random();
    if (r < .3 + prog * .08) gapSeg(v, prog, false);
    else if (r < .45 + prog * .05){ const s = makeSeg('ramp', 18, { h: 3.2 }); s.leadsGap = Math.random() < .65; }
    else flatSeg(rand(70, 120), prog, false);
  }
  function gapSeg(v, prog, fromRamp){
    const k = diff.gapK;
    let L = v * rand(.55, .8 + prog * .55) * k + (fromRamp ? 10 : 0);
    L = clamp(L, 12, 34 + 70 * prog * k);
    const from = lastBase();
    let land = from;
    if (Math.random() < .45) land = clamp(from + pick([-5, -3.5, -2, 1.5, 2.5]), -8, 6);
    const prev = segs[segs.length - 1];
    if (prev.type === 'flat' && prev.z1 - prev.z0 > 70) addGantry(prev, prev.z1 - 62, ['JUMP!', '谷 ' + Math.round(L) + 'm' + (land > from + .5 ? ' · 上り' : land < from - .5 ? ' · 下り' : '')], land > from + .5 ? 'red' : 'amber');
    const s = makeSeg('gap', L, { landBase: land });
    // ring arc following an assisted jump trajectory
    const n = Math.max(2, Math.round(L / 9));
    const peak = 4.5 + L * .06 + (fromRamp ? 2 : 0);
    const xs = rand(-2.4, 2.4), xe = clamp(xs + rand(-3, 3), -3.6, 3.6);
    for (let i = 1; i <= n; i++){
      const t = i / (n + 1);
      addRing(s, xs + (xe - xs) * t, Math.max(from, land) + 1.5 + peak * Math.sin(Math.PI * t), s.z0 + L * t);
    }
    if (L > 30 && Math.random() < .6) addCell(s, xs, Math.max(from, land) + peak * .7, s.z0 + L * .5);
  }
  function flatSeg(len, prog, calm){
    const s = makeSeg('flat', len);
    let z = s.z0 + (calm ? 28 : 18);
    const ob = diff.obst * (.5 + prog * .7);
    while (z < s.z1 - 14){
      const roll = Math.random();
      if (!calm && roll < ob){
        if (Math.random() < .2 + prog * .25 && z < s.z1 - 30){
          const sp = rand(7, 10);
          LANES.forEach(x => addVehicle(s, x, z, true, sp));
          addRing(s, 0, s.base + 6.2, z - 2); addRing(s, 0, s.base + 6.8, z + 6);
          z += 34;
        } else {
          const lanes = [...LANES].sort(() => Math.random() - .5).slice(0, Math.random() < .45 + prog * .3 ? 2 : 1);
          const sp = rand(8, 13);
          lanes.forEach(x => addVehicle(s, x + rand(-.3, .3), z + rand(-3, 3), false, sp));
          const free = LANES.find(x => !lanes.includes(x));
          if (free !== undefined && Math.random() < .5) addRing(s, free, s.base + 1.6, z);
          z += 26;
        }
      } else if (roll < .74){
        addCell(s, pick(LANES), s.base + 1, z); z += 20;
      } else {
        const x0 = pick(LANES);
        for (let k = 0; k < 4; k++) addRing(s, x0 + Math.sin(k * .9) * 2.2, s.base + 2 + Math.sin(k / 3 * Math.PI) * 3.2, z + k * 6);
        z += 30;
      }
    }
    return s;
  }

  /* ---------- scenery tiles ---------- */
  function buildTile(z0){
    const zi = zoneIndexAt(z0 + TILE / 2), key = ZONES[zi].key;
    const g = new THREE.Group(); sceneryGroup.add(g);
    const gr = new THREE.Mesh(new THREE.PlaneGeometry(1800, TILE).rotateX(-Math.PI / 2), Md.smat(key === 'canyon' ? 'sand' : key === 'city' ? 'cityground' : 'snow'));
    gr.position.set(0, GROUND_Y, z0 + TILE / 2); gr.receiveShadow = false; g.add(gr);
    const zr = () => z0 + Math.random() * TILE;
    if (key === 'canyon'){
      for (const s of [-1, 1]){
        // canyon walls
        const wall = Md.mesa((Math.random() * 99) | 0); const h = rand(70, 120);
        wall.scale.set(rand(28, 40), h, TILE * .62); wall.position.set(s * rand(78, 110), GROUND_Y + h / 2 - 4, z0 + TILE / 2); g.add(wall);
        for (let k = 0; k < 2; k++){ const m = Md.mesa((Math.random() * 99) | 0); const r = rand(30, 90), hh = rand(50, 160); m.scale.set(r, hh, r); m.position.set(s * rand(180, 620), GROUND_Y + hh / 2 - 5, zr()); g.add(m); }
        for (let k = 0; k < 3; k++){ const b = Md.boulder((Math.random() * 99) | 0); const r = rand(2, 7); b.scale.set(r, r * .7, r); b.position.set(s * rand(14, 70), GROUND_Y + r * .2, zr()); g.add(b); }
        for (let k = 0; k < 3; k++){ const c = Md.cactus(); const sc = rand(.8, 1.4); c.scale.setScalar(sc); c.position.set(s * rand(12, 70), GROUND_Y, zr()); c.rotation.y = Math.random() * 6; g.add(c); }
      }
      if (Math.random() < .25){ const a = Md.arch(); const sc = rand(1, 1.6); a.scale.setScalar(sc); a.position.set(pick([-1, 1]) * rand(140, 260), GROUND_Y, zr()); a.rotation.y = Math.PI / 2 + rand(-.4, .4); g.add(a); }
    } else if (key === 'city'){
      for (const s of [-1, 1]){
        for (let k = 0; k < 3; k++){ const w = rand(18, 30), d = rand(18, 34), h = rand(50, 150); const b = Md.building((Math.random() * 4) | 0, w, h, d); b.position.set(s * (rand(26, 40) + w / 2), GROUND_Y + h / 2, z0 + 20 + k * 40 + rand(-6, 6)); g.add(b); }
        for (let k = 0; k < 3; k++){ const w = rand(30, 60), d = rand(30, 60), h = rand(120, 320); const b = Md.building((Math.random() * 4) | 0, w, h, d); b.position.set(s * rand(110, 420), GROUND_Y + h / 2, zr()); g.add(b);
          if (Math.random() < .6){ const tip = Md.sprite(Md.mats().glowSprite, 0xff2020, 8); tip.position.set(b.position.x, GROUND_Y + h + 4, b.position.z); tip.userData.blink = Math.random() * 6; g.add(tip); dynamic.beacons.push({ sprite: tip, tile: g }); } }
        if (Math.random() < .55){ const bb = Md.billboard((Math.random() * 6) | 0); bb.position.set(s * rand(16, 22), 0, zr()); bb.rotation.y = s * -.35 + Math.PI; const pole = Md.box(.5, 60, .5, Md.mats().pole, 0, -26, -.3); bb.add(pole); g.add(bb); }
      }
      // flying traffic
      for (let k = 0; k < 2; k++){ const f = Md.sprite(Md.mats().glowSprite, Math.random() < .5 ? 0xffe2b0 : 0xff4060, 4); f.position.set(rand(-300, 300), rand(15, 60), zr()); f.userData.v = new THREE.Vector3(rand(-30, 30), 0, rand(-20, 30)); g.add(f); dynamic.flyers.push({ sprite: f, tile: g }); }
    } else {
      for (const s of [-1, 1]){
        for (let k = 0; k < 2; k++){ const p = Md.icePeak((Math.random() * 99) | 0); const r = rand(60, 160), h = rand(120, 300); p.scale.set(r, h / 1.4, r); p.position.set(s * rand(160, 600), GROUND_Y + h / 2 - 10, zr()); g.add(p); }
        const p2 = Md.icePeak((Math.random() * 99) | 0); const r2 = rand(25, 45), h2 = rand(60, 110); p2.scale.set(r2, h2 / 1.4, r2 * 1.5); p2.position.set(s * rand(70, 100), GROUND_Y + h2 / 2 - 6, zr()); g.add(p2);
        for (let k = 0; k < 6; k++){ const t = Md.pine(); const sc = rand(1, 2.2); t.scale.setScalar(sc); t.position.set(s * rand(12, 80), GROUND_Y, zr()); g.add(t); }
        for (let k = 0; k < 2; k++){ const c = Md.crystal(); const sc = rand(2, 5); c.scale.set(sc * .6, sc * 2.2, sc * .6); c.position.set(s * rand(16, 60), GROUND_Y + sc, zr()); c.rotation.set(rand(-.3, .3), rand(0, 6), rand(-.3, .3)); g.add(c); }
      }
    }
    tiles.push({ z0, z1: z0 + TILE, group: g, zone: zi });
  }
  function disposeGroup(g){
    g.traverse(o => {
      if (o.geometry && o.geometry.userData.disposable) o.geometry.dispose();
      if (o.material){ const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach(m => { if (m.userData.own || (o.isSprite && m !== Md.mats().glowSprite)) m.dispose(); }); }
    });
  }

  /* ---------- API ---------- */
  function reset(difficulty){
    diff = difficulty;
    segs.forEach(s => { trackGroup.remove(s.group); disposeGroup(s.group); });
    tiles.forEach(t => { sceneryGroup.remove(t.group); disposeGroup(t.group); });
    segs = []; tiles = []; buildZ = -90; segCount = 0; tileZ = -TILE * 2;
    dynamic.beacons = []; dynamic.flyers = [];
  }
  function runwayOnly(difficulty){
    reset(difficulty);
    makeSeg('flat', 320, { safe: true, base: 0 });
    for (let z = -TILE * 2; z < 600; z += TILE) buildTile(z);
    tileZ = 600;
  }
  function ensure(z){
    while (buildZ < z + 520) generate();
    while (tileZ < z + 700){ buildTile(tileZ); tileZ += TILE; }
    while (segs.length && segs[0].z1 < z - 60){ const s = segs.shift(); trackGroup.remove(s.group); disposeGroup(s.group); }
    while (tiles.length && tiles[0].z1 < z - 260){ const t = tiles.shift(); sceneryGroup.remove(t.group); disposeGroup(t.group); dynamic.beacons = dynamic.beacons.filter(b => b.tile !== t.group); dynamic.flyers = dynamic.flyers.filter(b => b.tile !== t.group); }
  }

  function floorAt(z, x){
    if (Math.abs(x) > HALF_W + .5) return null;
    for (let i = 0; i < segs.length; i++){
      const s = segs[i];
      if (z >= s.z0 && z < s.z1){
        if (s.type === 'flat') return { h: s.base, slope: 0, seg: s };
        if (s.type === 'ramp') return { h: s.base + s.h * (z - s.z0) / (s.z1 - s.z0), slope: s.h / (s.z1 - s.z0), seg: s };
        return null;
      }
    }
    return null;
  }
  function segAt(z){ for (const s of segs) if (z >= s.z0 && z < s.z1) return s; return null; }

  let t = 0;
  function update(dt, playerZ, playerSpeed){
    t += dt;
    Md.flameUniforms.time.value = t;
    skyMat.uniforms.time.value = t;
    for (const s of segs){
      if (s.z1 < playerZ - 40 || s.z0 > playerZ + 520) continue;
      for (const r of s.rings){ if (!r.got) r.mesh.rotation.z = t * .6 + r.phase; }
      for (const c of s.cells){ if (!c.got){ c.mesh.rotation.y = t * 1.6 + c.phase; c.mesh.position.y = c.y + Math.sin(t * 2.4 + c.phase) * .18; } }
      for (const b of s.beacons){ const on = Math.sin(t * 9 + b.position.z) > 0; b.userData.blink.visible = on; }
      for (const o of s.obst){
        if (!o.active && o.z - playerZ < 170) o.active = true;
        if (o.active){
          const lim = s.z1 - o.l / 2 - 3;
          let sp = o.speed; if (o.z >= lim - 6){ sp = Math.max(0, (lim - o.z) * 1.5); o.braking = true; }
          o.z = Math.min(lim, o.z + sp * dt); o.group.position.z = o.z - (o.truck ? .5 : 0);
          if (o.group.userData.brake) o.group.userData.brake.material = o.braking ? Md.mats().brakeGlow : Md.mats().redGlow;
        }
      }
    }
    for (const b of dynamic.beacons){ b.sprite.visible = Math.sin(t * 3 + b.sprite.userData.blink) > .2; }
    for (const f of dynamic.flyers){ f.sprite.position.addScaledVector(f.sprite.userData.v, dt); }
  }

  return {
    init, reset, runwayOnly, ensure, update, floorAt, segAt, setZoneBlend, setShadowSize, zoneIndexAt,
    get segs(){ return segs; }, get sky(){ return sky; }, get sun(){ return sun; }, get fill(){ return fill; },
    ZONES, HALF_W, LANES, ZONE_LEN, GROUND_Y, speedAt,
  };
})();
