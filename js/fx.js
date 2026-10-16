/* ============================================================
 * Thrust Roadster — visual effects
 * particles, speed lines, debris, landing guide, shockwave, weather
 * ============================================================ */
window.TR = window.TR || {};
TR.FX = (() => {
  'use strict';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  let scene, pointScale = { value: 600 };

  /* ---------- GPU-friendly particle pool ---------- */
  class Particles {
    constructor(max, tex, additive){
      this.max = max; this.cursor = 0;
      this.pos = new Float32Array(max * 3); this.rgba = new Float32Array(max * 4); this.size = new Float32Array(max);
      this.vel = new Float32Array(max * 3); this.life = new Float32Array(max); this.maxLife = new Float32Array(max);
      this.c0 = new Float32Array(max * 3); this.c1 = new Float32Array(max * 3); this.a0 = new Float32Array(max);
      this.s0 = new Float32Array(max); this.s1 = new Float32Array(max); this.grav = new Float32Array(max); this.drag = new Float32Array(max);
      for (let i = 0; i < max; i++) this.pos[i * 3 + 1] = -1e5;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('rgba', new THREE.BufferAttribute(this.rgba, 4).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
      const m = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        uniforms: { map: { value: tex }, scale: pointScale },
        vertexShader: 'attribute vec4 rgba; attribute float size; uniform float scale; varying vec4 vC; void main(){ vC = rgba; vec4 mv = modelViewMatrix*vec4(position,1.); gl_PointSize = clamp(size*scale/-mv.z, 0., 256.); gl_Position = projectionMatrix*mv; }',
        fragmentShader: 'uniform sampler2D map; varying vec4 vC; void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC.rgb*t.rgb, vC.a*t.a); }'
      });
      this.points = new THREE.Points(g, m); this.points.frustumCulled = false; this.points.renderOrder = 6;
      this.geo = g; this.alive = 0;
    }
    emit(x, y, z, vx, vy, vz, life, s0, s1, c0, c1, a0 = 1, grav = 0, drag = 1){
      const i = this.cursor; this.cursor = (this.cursor + 1) % this.max;
      const i3 = i * 3;
      this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
      this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
      this.life[i] = life; this.maxLife[i] = life; this.s0[i] = s0; this.s1[i] = s1; this.a0[i] = a0; this.grav[i] = grav; this.drag[i] = drag;
      this.c0[i3] = c0[0]; this.c0[i3 + 1] = c0[1]; this.c0[i3 + 2] = c0[2];
      const e = c1 || c0; this.c1[i3] = e[0]; this.c1[i3 + 1] = e[1]; this.c1[i3 + 2] = e[2];
    }
    update(dt){
      const P = this.pos, V = this.vel; let alive = 0;
      for (let i = 0; i < this.max; i++){
        if (this.life[i] <= 0) continue;
        this.life[i] -= dt; const i3 = i * 3, i4 = i * 4;
        if (this.life[i] <= 0){ P[i3 + 1] = -1e5; this.rgba[i4 + 3] = 0; continue; }
        alive++;
        const k = 1 - this.life[i] / this.maxLife[i];
        const d = Math.pow(this.drag[i], dt * 60);
        V[i3] *= d; V[i3 + 1] = V[i3 + 1] * d - this.grav[i] * dt; V[i3 + 2] *= d;
        P[i3] += V[i3] * dt; P[i3 + 1] += V[i3 + 1] * dt; P[i3 + 2] += V[i3 + 2] * dt;
        this.rgba[i4] = this.c0[i3] + (this.c1[i3] - this.c0[i3]) * k;
        this.rgba[i4 + 1] = this.c0[i3 + 1] + (this.c1[i3 + 1] - this.c0[i3 + 1]) * k;
        this.rgba[i4 + 2] = this.c0[i3 + 2] + (this.c1[i3 + 2] - this.c0[i3 + 2]) * k;
        this.rgba[i4 + 3] = this.a0[i] * (k < .1 ? k / .1 : 1 - (k - .1) / .9);
        this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * k;
      }
      this.alive = alive;
      this.geo.attributes.position.needsUpdate = true; this.geo.attributes.rgba.needsUpdate = true; this.geo.attributes.size.needsUpdate = true;
    }
    clear(){ this.life.fill(0); for (let i = 0; i < this.max; i++){ this.pos[i * 3 + 1] = -1e5; this.rgba[i * 4 + 3] = 0; } }
  }

  let glowP, smokeP, lines, lineGeo, linePos, lineMat, debris, debrisVel = [], debrisLife = 0, guide, guideDots, guideDotPos, guideMat, guideRing, shock, shockLife = 0, weather, weatherPos, weatherMat, weatherKind = -1;
  const LINES = 70;

  function init(sc){
    scene = sc;
    glowP = new Particles(1800, TR.Tex.glow(), true); scene.add(glowP.points);
    smokeP = new Particles(700, TR.Tex.smoke(), false); scene.add(smokeP.points);
    // speed lines
    linePos = new Float32Array(LINES * 6); lineGeo = new THREE.BufferGeometry(); lineGeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3).setUsage(THREE.DynamicDrawUsage));
    lineMat = new THREE.LineBasicMaterial({ color: 0xbff6ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    lines = new THREE.LineSegments(lineGeo, lineMat); lines.frustumCulled = false; scene.add(lines);
    for (let i = 0; i < LINES; i++) resetLine(i, new THREE.Vector3(), true);
    // debris
    const dg = new THREE.BoxGeometry(.28, .08, .4);
    debris = new THREE.InstancedMesh(dg, new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: .6, roughness: .35 }), 36);
    debris.instanceMatrix.setUsage(THREE.DynamicDrawUsage); debris.visible = false; debris.castShadow = true; scene.add(debris);
    for (let i = 0; i < 36; i++) debrisVel.push({ p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Euler(), w: new THREE.Vector3() });
    // landing guide: dotted arc + target ring
    guideDotPos = new Float32Array(40 * 3); const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.BufferAttribute(guideDotPos, 3).setUsage(THREE.DynamicDrawUsage));
    guideMat = new THREE.PointsMaterial({ size: .55, map: TR.Tex.glow(), color: 0x7cffd0, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
    guideDots = new THREE.Points(gg, guideMat); guideDots.frustumCulled = false; guideDots.renderOrder = 8; scene.add(guideDots);
    // landing target: bold ring + soft disc + light pillar (readable at a glance)
    // drawn on top of everything: the car itself often sits between the camera and the landing spot
    const gm = new THREE.MeshBasicMaterial({ color: 0x7cffd0, transparent: true, opacity: .95, depthWrite: false, depthTest: false, side: THREE.DoubleSide, fog: false });
    const rg = new THREE.RingGeometry(1.45, 1.95, 48); rg.rotateX(-Math.PI / 2);
    guideRing = new THREE.Mesh(rg, gm);
    const discM = gm.clone(); discM.opacity = .22; discM.blending = THREE.AdditiveBlending;
    const disc = new THREE.Mesh(new THREE.CircleGeometry(1.45, 32).rotateX(-Math.PI / 2), discM); disc.renderOrder = 9; guideRing.add(disc);
    const pillarM = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, uniforms: { col: { value: gm.color } },
      vertexShader: 'varying float vY; void main(){ vY = uv.y; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
      fragmentShader: 'uniform vec3 col; varying float vY; void main(){ float a = pow(1.-vY, 2.)*.7; gl_FragColor = vec4(col*a*1.6, a); }' });
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.6, 7, 24, 1, true).translate(0, 3.5, 0), pillarM); pillar.renderOrder = 9; guideRing.add(pillar);
    guideRing.userData = { disc: discM };
    guideRing.renderOrder = 9; scene.add(guideRing);
    guide = { group: guideDots };
    // shockwave
    shock = new THREE.Mesh(new THREE.RingGeometry(.85, 1, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x8cfff1, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    scene.add(shock);
    // weather (snow / dust motes) around the camera
    const WN = 900; weatherPos = new Float32Array(WN * 3);
    for (let i = 0; i < WN; i++){ weatherPos[i * 3] = rand(-40, 40); weatherPos[i * 3 + 1] = rand(-10, 30); weatherPos[i * 3 + 2] = rand(-20, 80); }
    const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.BufferAttribute(weatherPos, 3).setUsage(THREE.DynamicDrawUsage));
    weatherMat = new THREE.PointsMaterial({ size: .16, map: TR.Tex.glow(), color: 0xffffff, transparent: true, opacity: 0, depthWrite: false });
    weather = new THREE.Points(wg, weatherMat); weather.frustumCulled = false; scene.add(weather);
  }
  function setPointScale(px){ pointScale.value = px; }

  function resetLine(i, cam, scatter){
    const a = Math.random() * Math.PI * 2, r = rand(3.5, 16);
    const x = cam.x + Math.cos(a) * r, y = cam.y + Math.sin(a) * r * .6, z = cam.z + (scatter ? rand(5, 90) : rand(60, 95));
    linePos.set([x, y, z, x, y, z], i * 6);
  }
  function updateLines(dt, cam, speed, boost){
    const k = clamp((speed - 26) / 26, 0, 1) * .5 + (boost ? .45 : 0);
    lineMat.opacity += (k - lineMat.opacity) * Math.min(1, dt * 4);
    lines.visible = lineMat.opacity > .01;
    if (!lines.visible) return;
    const len = speed * (boost ? .14 : .08), mv = speed * dt * 1.6;
    for (let i = 0; i < LINES; i++){
      const o = i * 6; linePos[o + 2] -= mv; linePos[o + 5] = linePos[o + 2] - len;
      if (linePos[o + 2] < cam.z - 2) resetLine(i, cam, false);
    }
    lineGeo.attributes.position.needsUpdate = true;
  }

  // emitters ----------------------------------------------------------
  const C = {
    jet: [[.85, .97, 1], [.2, .55, 1]], boost: [[1, .95, .85], [.35, .45, 1]], spark: [[1, .85, .4], [1, .3, .05]],
    gold: [[1, .9, .5], [1, .45, .1]], cyan: [[.6, 1, 1], [.1, .5, 1]], fire: [[1, .75, .3], [.8, .15, .05]],
  };
  function jet(x, y, z, vx, vy, vz){ glowP.emit(x, y, z, vx + rand(-1.2, 1.2), vy, vz + rand(-1, 1), rand(.18, .32), .9, 2.2, C.jet[0], C.jet[1], .9, 0, .9); }
  function boostFlame(x, y, z, vz){ glowP.emit(x + rand(-.05, .05), y + rand(-.05, .05), z, rand(-.6, .6), rand(-.6, .6), vz, rand(.12, .22), 1.1, 2.6, C.boost[0], C.boost[1], .9, 0, .92); }
  function groundDust(x, y, z, vz, color){ smokeP.emit(x + rand(-1.5, 1.5), y + .2, z + rand(-1, 1), rand(-5, 5), rand(.5, 2.5), vz, rand(.6, 1.1), 1.6, 5, color || [.75, .65, .6], null, .35, -.6, .94); }
  function sparks(x, y, z, vz, n = 6, dir = 0){ for (let i = 0; i < n; i++) glowP.emit(x, y, z, dir * rand(2, 6) + rand(-2, 2), rand(1, 5), vz + rand(-3, 3), rand(.25, .5), .35, .1, C.spark[0], C.spark[1], 1, 14, .97); }
  function ringBurst(x, y, z, vz, hot){
    const col = hot ? C.cyan : C.gold;
    for (let i = 0; i < 40; i++){ const a = i / 40 * Math.PI * 2; glowP.emit(x + Math.cos(a) * 1.9, y + Math.sin(a) * 1.9, z, Math.cos(a) * rand(4, 9), Math.sin(a) * rand(4, 9), vz, rand(.4, .8), .7, .1, col[0], col[1], 1, 2, .93); }
  }
  function cellBurst(x, y, z, vz){ for (let i = 0; i < 34; i++){ glowP.emit(x, y, z, rand(-6, 6), rand(-3, 7), vz + rand(-4, 4), rand(.4, .9), .6, .1, C.cyan[0], C.cyan[1], 1, 6, .95); } }
  function explosion(x, y, z, vz, paint){
    for (let i = 0; i < 160; i++){ const a = Math.random() * Math.PI * 2, b = rand(-.2, 1); glowP.emit(x, y + .5, z, Math.cos(a) * rand(4, 18), b * 16, Math.sin(a) * rand(4, 18) + vz * .4, rand(.5, 1.3), rand(.8, 1.8), .2, C.fire[0], C.fire[1], 1, 9, .95); }
    for (let i = 0; i < 40; i++) smokeP.emit(x + rand(-1, 1), y + rand(0, 2), z + rand(-1, 1), rand(-3, 3), rand(1, 5), vz * .3 + rand(-2, 2), rand(1.4, 2.6), 3, 9, [.2, .18, .2], [.08, .08, .1], .7, -1, .96);
    // debris
    debris.visible = true; debrisLife = 3; debris.material.color.set(paint || 0xdddddd);
    debrisVel.forEach(d => { d.p.set(x + rand(-.8, .8), y + rand(.2, 1), z + rand(-1.5, 1.5)); d.v.set(rand(-9, 9), rand(4, 15), vz * .5 + rand(-6, 10)); d.r.set(rand(0, 6), rand(0, 6), rand(0, 6)); d.w.set(rand(-12, 12), rand(-12, 12), rand(-12, 12)); d.floor = y - .2; });
  }
  const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
  function updateDebris(dt){
    if (!debris.visible) return; debrisLife -= dt; if (debrisLife <= 0){ debris.visible = false; return; }
    debrisVel.forEach((d, i) => {
      d.v.y -= 22 * dt; d.p.addScaledVector(d.v, dt);
      if (d.p.y < d.floor && d.floor > -40){ d.p.y = d.floor; d.v.y *= -.35; d.v.x *= .7; d.v.z *= .7; d.w.multiplyScalar(.7); }
      d.r.x += d.w.x * dt; d.r.y += d.w.y * dt; d.r.z += d.w.z * dt;
      tmpM.compose(d.p, tmpQ.setFromEuler(d.r), one); debris.setMatrixAt(i, tmpM);
    });
    debris.instanceMatrix.needsUpdate = true;
  }
  function touchdown(x, y, z, perfect){ shockLife = 1; shock.position.set(x, y + .05, z); shock.material.color.setHex(perfect ? 0x8cfff1 : 0xffc88a); }

  // trajectory guide: color 0 = safe, 1 = hard, 2 = danger
  const GCOL = [new THREE.Color(0x7cffd0), new THREE.Color(0xffc24a), new THREE.Color(0xff4a3a)];
  function setGuide(visible, pts, land, kind){
    guideDots.visible = guideRing.visible = visible;
    if (!visible) return;
    const n = Math.min(40, pts.length);
    for (let i = 0; i < 40; i++){ const p = pts[Math.min(i, n - 1)]; guideDotPos[i * 3] = p.x; guideDotPos[i * 3 + 1] = p.y; guideDotPos[i * 3 + 2] = p.z; }
    guideDots.geometry.attributes.position.needsUpdate = true; guideDots.geometry.setDrawRange(0, n);
    guideMat.color.copy(GCOL[kind]); guideRing.material.color.copy(GCOL[kind]); guideRing.userData.disc.color.copy(GCOL[kind]);
    if (land){ guideRing.visible = true; guideRing.position.set(land.x, land.y + .06, land.z); const s = 1 + Math.sin(performance.now() * .012) * .1; guideRing.scale.set(s, 1, s); }
    else guideRing.visible = false;
  }

  function setWeather(kind){ weatherKind = kind; }
  function updateWeather(dt, cam, speed){
    const target = weatherKind === 2 ? .9 : weatherKind === 0 ? .35 : 0;
    weatherMat.opacity += (target - weatherMat.opacity) * Math.min(1, dt * 1.5);
    weather.visible = weatherMat.opacity > .02; if (!weather.visible) return;
    weatherMat.color.setHex(weatherKind === 2 ? 0xeaf6ff : 0xffc9a0); weatherMat.size = weatherKind === 2 ? .2 : .09;
    const fall = weatherKind === 2 ? 3.2 : -.2;
    for (let i = 0; i < weatherPos.length; i += 3){
      weatherPos[i + 1] -= fall * dt; weatherPos[i] += Math.sin(i + performance.now() * .0005) * dt * .8;
      let rx = weatherPos[i] - cam.x, ry = weatherPos[i + 1] - cam.y, rz = weatherPos[i + 2] - cam.z;
      if (rz < -15) weatherPos[i + 2] += 95; if (rz > 80) weatherPos[i + 2] -= 95;
      if (rx < -40) weatherPos[i] += 80; if (rx > 40) weatherPos[i] -= 80;
      if (ry < -12) weatherPos[i + 1] += 42; if (ry > 30) weatherPos[i + 1] -= 42;
    }
    weather.geometry.attributes.position.needsUpdate = true;
  }

  function update(dt, cam, speed, boost){
    glowP.update(dt); smokeP.update(dt); updateLines(dt, cam, speed, boost); updateDebris(dt); updateWeather(dt, cam, speed);
    if (shockLife > 0){ shockLife = Math.max(0, shockLife - dt * 1.6); const s = 1 + (1 - shockLife) * 9; shock.scale.set(s, 1, s); shock.material.opacity = shockLife * .55; } else shock.material.opacity = 0;
  }
  function clear(){ glowP.clear(); smokeP.clear(); debris.visible = false; shockLife = 0; setGuide(false); }

  return { init, update, clear, setPointScale, jet, boostFlame, groundDust, sparks, ringBurst, cellBurst, explosion, touchdown, setGuide, setWeather };
})();
