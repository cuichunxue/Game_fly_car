/* ============================================================
 * Thrust Roadster — 3D models (all procedural geometry)
 * ============================================================ */
window.TR = window.TR || {};
TR.Models = (() => {
  'use strict';
  const T = TR.Tex;
  const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const bump = (t, c, s) => Math.exp(-((t - c) * (t - c)) / (2 * s * s));
  const spow = (v, p) => Math.sign(v) * Math.pow(Math.abs(v), p);
  // cosine-smoothed piecewise curve through [t, value] points
  const curve = pts => t => {
    if (t <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++){
      if (t <= pts[i][0]){ const [t0, v0] = pts[i - 1], [t1, v1] = pts[i]; const k = (t - t0) / (t1 - t0); const s = (1 - Math.cos(k * Math.PI)) / 2; return v0 + (v1 - v0) * s; }
    }
    return pts[pts.length - 1][1];
  };

  /* Loft: sweeps a superellipse cross-section along z.
   * prof(t) -> { w: half width, yb: bottom, yt: top, p: exponent, tuck: top narrowing } */
  function loft(z0, z1, prof, n = 56, m = 36, capR = .025, capF = .05){
    const pos = [], uv = [], idx = [];
    for (let i = 0; i <= n; i++){
      const t = i / n, z = z0 + (z1 - z0) * t;
      const P = prof(t);
      const fr = Math.pow(Math.min(1, t / capR), .5), ff = Math.pow(Math.min(1, (1 - t) / capF), .5);
      const f = Math.max(.001, Math.min(fr, ff));
      const yc = (P.yb + P.yt) / 2, hh = (P.yt - P.yb) / 2 * f, w = P.w * f, p = P.p || .5;
      for (let j = 0; j <= m; j++){
        const a = j / m, th = -Math.PI / 2 + a * Math.PI * 2;
        const c = Math.cos(th), s = Math.sin(th);
        const sy = spow(s, p);
        const tuck = 1 - (P.tuck || 0) * Math.max(0, sy);
        pos.push(w * spow(c, p) * tuck, yc + hh * sy, z);
        uv.push(t, a);
      }
    }
    for (let i = 0; i < n; i++) for (let j = 0; j < m; j++){
      const a = i * (m + 1) + j, b = a + m + 1, c = a + 1, d = b + 1;
      idx.push(a, c, b, c, d, b);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  }

  /* ---------- shared materials ---------- */
  let M = null;
  function mats(){
    if (M) return M;
    const road = T.road(), glow = T.glow();
    M = {
      road: new THREE.MeshStandardMaterial({ map: road.map, normalMap: road.normalMap, roughnessMap: road.roughnessMap, roughness: .92, metalness: .05, normalScale: new THREE.Vector2(.5, .5), envMapIntensity: .5 }),
      concrete: new THREE.MeshStandardMaterial({ map: T.concrete(), roughness: .88, metalness: 0, envMapIntensity: .3 }),
      hazard: new THREE.MeshStandardMaterial({ map: T.hazard(), roughness: .6, emissive: 0x332200, emissiveIntensity: .5 }),
      chevron: new THREE.MeshStandardMaterial({ map: T.chevron(), emissiveMap: T.chevron(), emissive: 0xffffff, emissiveIntensity: .3, roughness: .7 }),
      rail: new THREE.MeshStandardMaterial({ color: 0x8a929c, metalness: .85, roughness: .38, envMapIntensity: .7 }),
      railGlow: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff9a3c).multiplyScalar(1.4) }),
      cyanGlow: new THREE.MeshBasicMaterial({ color: new THREE.Color(0x63fff0).multiplyScalar(2.5) }),
      whiteGlow: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff4e0).multiplyScalar(5) }),
      redGlow: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff2a1a).multiplyScalar(4) }),
      brakeGlow: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff3a22).multiplyScalar(10) }),
      amberGlow: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffa020).multiplyScalar(3.5) }),
      darkMetal: new THREE.MeshStandardMaterial({ color: 0x2a2c33, metalness: .8, roughness: .35 }),
      pole: new THREE.MeshStandardMaterial({ color: 0x3c4048, metalness: .7, roughness: .45 }),
      glass: new THREE.MeshPhysicalMaterial({ color: 0x0b1724, metalness: .2, roughness: .04, clearcoat: 1, clearcoatRoughness: .02, envMapIntensity: 2.2, reflectivity: 1 }),
      tire: new THREE.MeshStandardMaterial({ map: T.tire(), roughness: .9, metalness: 0 }),
      rim: new THREE.MeshStandardMaterial({ color: 0xd8dde3, metalness: 1, roughness: .18, envMapIntensity: 1.6 }),
      carbon: new THREE.MeshStandardMaterial({ map: T.carbon(), metalness: .4, roughness: .35, envMapIntensity: 1.2 }),
      caliper: new THREE.MeshStandardMaterial({ color: 0xff3b2f, roughness: .4, metalness: .3 }),
      nozzle: new THREE.MeshStandardMaterial({ color: 0x8a8f99, metalness: 1, roughness: .22, envMapIntensity: 1.4 }),
      ring: new THREE.MeshStandardMaterial({ color: 0xffd27a, emissive: 0xffa020, emissiveIntensity: 2.2, metalness: .8, roughness: .25 }),
      ringHot: new THREE.MeshStandardMaterial({ color: 0xbaffff, emissive: 0x5cf6ff, emissiveIntensity: 3, metalness: .8, roughness: .25 }),
      cellGlass: new THREE.MeshPhysicalMaterial({ color: 0x9fe8ff, metalness: 0, roughness: .05, transparent: true, opacity: .35, clearcoat: 1, envMapIntensity: 2, depthWrite: false }),
      cellCore: new THREE.MeshBasicMaterial({ color: new THREE.Color(0x4fd8ff).multiplyScalar(3) }),
      glowSprite: new THREE.SpriteMaterial({ map: glow, color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    };
    return M;
  }
  function sprite(mat, color, size, x = 0, y = 0, z = 0){
    const m = mat.clone(); m.color = new THREE.Color(color);
    const s = new THREE.Sprite(m); s.scale.set(size, size, 1); s.position.set(x, y, z); return s;
  }
  function flareSprite(color, w, h){
    const m = new THREE.SpriteMaterial({ map: T.flare(), color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const s = new THREE.Sprite(m); s.scale.set(w, h, 1); return s;
  }
  function box(w, h, l, mat, x = 0, y = 0, z = 0){ const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), mat); m.position.set(x, y, z); return m; }

  /* ---------- flame shader ---------- */
  const flameUniforms = { time: { value: 0 } };
  function flameMaterial(colA, colB){
    return new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { time: flameUniforms.time, colA: { value: new THREE.Color(colA) }, colB: { value: new THREE.Color(colB) }, power: { value: 0 } },
      vertexShader: `varying vec2 vUv; varying float vF; void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position,1.); vec3 n = normalize(normalMatrix * normal); vF = abs(dot(n, normalize(-mv.xyz))); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform float time; uniform vec3 colA; uniform vec3 colB; uniform float power; varying vec2 vUv; varying float vF;
        float h(float n){ return fract(sin(n)*43758.5453); }
        void main(){
          float v = vUv.y;
          float flick = .78 + .22*sin(time*70. + vUv.x*31.4) * sin(time*43. + v*12.);
          float shock = .65 + .35*sin(v*38. - time*90.);
          float a = pow(1.-v, 1.4) * pow(vF, 1.6) * flick * mix(1., shock, .35) * power;
          vec3 c = mix(colA, colB, smoothstep(0., .8, v));
          gl_FragColor = vec4(c * a * 2.4, a);
        }`
    });
  }
  function flameCone(r, h, colA, colB){
    const g = new THREE.ConeGeometry(r, h, 18, 8, true); g.rotateX(Math.PI); g.translate(0, -h / 2, 0);
    const m = new THREE.Mesh(g, flameMaterial(colA, colB)); m.frustumCulled = false; m.renderOrder = 5;
    return m;
  }

  /* ---------- player car ---------- */
  function wheel(radius = .36, width = .3, opts = {}){
    const Mt = mats(); const g = new THREE.Group();
    // tire: lathe of rounded rectangle profile around y, then turned to x axis
    const pr = []; const rw = width / 2, ri = radius * .66;
    for (let k = 0; k <= 12; k++){ const a = -Math.PI / 2 + k / 12 * Math.PI; pr.push(new THREE.Vector2(radius - .06 + Math.cos(a) * .06, Math.sin(a) * rw)); }
    pr.unshift(new THREE.Vector2(ri, -rw)); pr.push(new THREE.Vector2(ri, rw));
    const tg = new THREE.LatheGeometry(pr, 40); tg.rotateZ(Math.PI / 2);
    const tire = new THREE.Mesh(tg, Mt.tire); tire.castShadow = true; g.add(tire);
    const rimG = new THREE.CylinderGeometry(ri, ri, width * .9, 28); rimG.rotateZ(Math.PI / 2);
    g.add(new THREE.Mesh(rimG, Mt.darkMetal));
    // spokes on outer face
    const sp = new THREE.Group(); const side = opts.side || 1;
    for (let k = 0; k < 5; k++){
      const s = box(.03, ri * 1.9, .07, Mt.rim); s.rotation.x = k / 5 * Math.PI; s.position.x = side * width * .47; sp.add(s);
    }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(.07, .07, .05, 12).rotateZ(Math.PI / 2), Mt.rim); hub.position.x = side * width * .5; sp.add(hub);
    g.add(sp);
    if (opts.glow){
      const ringG = new THREE.TorusGeometry(ri * .88, .022, 6, 36); ringG.rotateY(Math.PI / 2);
      const glowRing = new THREE.Mesh(ringG, new THREE.MeshBasicMaterial({ color: 0x63fff0, transparent: true, opacity: 0 }));
      glowRing.position.x = side * width * .48; g.add(glowRing); g.userData.glowRing = glowRing;
    }
    return g;
  }

  function playerCar(paintKey){
    const Mt = mats();
    const root = new THREE.Group(), inner = new THREE.Group(); root.add(inner);
    const z0 = -2.25, z1 = 2.32;
    const top = curve([[0, .7], [.06, .84], [.22, .87], [.34, .82], [.5, .76], [.66, .72], [.8, .64], [.93, .52], [1, .44]]);
    const prof = t => ({
      w: .84 + .085 * bump(t, .2, .065) + .085 * bump(t, .81, .065) - .2 * smooth(.86, 1, t) - .06 * (1 - smooth(0, .1, t)),
      yb: .2 + .07 * smooth(.88, 1, t) + .05 * (1 - smooth(0, .06, t)),
      yt: top(t), p: .42, tuck: .2,
    });
    const bodyMat = new THREE.MeshPhysicalMaterial({ map: T.livery(paintKey), metalness: .5, roughness: .26, clearcoat: 1, clearcoatRoughness: .05, envMapIntensity: 1.35 });
    const body = new THREE.Mesh(loft(z0, z1, prof), bodyMat); body.castShadow = true; body.receiveShadow = false; inner.add(body);
    // canopy
    const ctop = curve([[0, .74], [.3, 1.1], [.55, 1.12], [.85, .98], [1, .74]]);
    const can = new THREE.Mesh(loft(-.75, .95, t => ({ w: .6 - .08 * Math.abs(t - .45), yb: .64, yt: ctop(t), p: .55, tuck: .35 }), 32, 28, .12, .18), Mt.glass);
    can.castShadow = true; inner.add(can);
    // roll hoop + head fairing
    const hoop = new THREE.Mesh(new THREE.TorusGeometry(.42, .05, 8, 20, Math.PI), Mt.carbon); hoop.position.set(0, .82, -.9); inner.add(hoop);
    // side intakes
    for (const s of [-1, 1]){
      const intake = box(.06, .18, .55, Mt.carbon, s * .9, .44, -.55); intake.rotation.y = s * .06; inner.add(intake);
      const neon = box(.025, .025, 2.6, Mt.cyanGlow, s * .86, .2, .05); inner.add(neon);
    }
    // rear wing
    const foil = new THREE.Shape(); foil.moveTo(0, 0); foil.bezierCurveTo(.1, .07, .35, .07, .5, .015); foil.lineTo(.5, 0); foil.bezierCurveTo(.3, -.02, .1, -.02, 0, 0);
    const wg = new THREE.ExtrudeGeometry(foil, { depth: 2.0, bevelEnabled: false }); wg.translate(-.25, 0, -1); wg.rotateY(Math.PI / 2);
    const wing = new THREE.Mesh(wg, Mt.carbon); wing.position.set(0, 1.12, -1.92); wing.rotation.x = -.1; wing.castShadow = true; inner.add(wing);
    for (const s of [-1, 1]){
      inner.add(box(.04, .26, .6, Mt.carbon, s * 1.0, 1.12, -1.95));
      const strut = box(.05, .36, .12, Mt.darkMetal, s * .45, .96, -1.86); strut.rotation.x = .25; inner.add(strut);
    }
    // lights
    for (const s of [-1, 1]){
      const hl = box(.42, .045, .06, Mt.whiteGlow, s * .5, .5, 2.2); hl.rotation.y = s * -.32; inner.add(hl);
      const f = flareSprite(0xbfdcff, 1.9, .3); f.material.opacity = .7; f.position.set(s * .52, .5, 2.33); inner.add(f);
    }
    const tail = box(1.62, .05, .04, Mt.redGlow, 0, .68, -2.25); inner.add(tail);
    const tailF = flareSprite(0xff3020, 2.4, .3); tailF.material.opacity = .8; tailF.position.set(0, .68, -2.32); inner.add(tailF);
    // rear boost nozzles
    const boosts = [];
    for (const s of [-1, 1]){
      const nz = new THREE.Mesh(new THREE.CylinderGeometry(.17, .21, .3, 20, 1, true).rotateX(Math.PI / 2), Mt.nozzle); nz.position.set(s * .42, .42, -2.26); inner.add(nz);
      const core = new THREE.Mesh(new THREE.CircleGeometry(.15, 20), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x5ad8ff), side: THREE.DoubleSide })); core.position.set(s * .42, .42, -2.2); core.rotation.y = Math.PI; inner.add(core);
      const fl = flameCone(.17, 2.6, 0xe8fbff, 0x3a6bff); fl.rotation.x = Math.PI / 2; fl.position.set(s * .42, .42, -2.36); inner.add(fl);
      boosts.push({ flame: fl, core });
    }
    // wheels with hover-fold pivots
    const wheels = [];
    for (const [z, s] of [[-1.36, 1], [-1.36, -1], [1.42, 1], [1.42, -1]]){
      const pivot = new THREE.Group(); pivot.position.set(s * .9, .36, z); inner.add(pivot);
      const spin = wheel(.36, .3, { side: s, glow: true }); pivot.add(spin);
      const jet = flameCone(.26, 2.4, 0xeafcff, 0x2fb8ff); jet.position.set(0, -.04, 0); pivot.add(jet);
      const cal = box(.06, .14, .2, Mt.caliper, -s * .02, .1, -.1); pivot.add(cal);
      wheels.push({ pivot, spin, jet, side: s, z, glowRing: spin.userData.glowRing });
    }
    // headlight beam
    const spot = new THREE.SpotLight(0xfff1d6, 3.2, 70, .5, .55, 1.4); spot.position.set(0, .7, 1.8); spot.target.position.set(0, -.6, 22); inner.add(spot); inner.add(spot.target);
    const under = new THREE.PointLight(0x61e8ff, 0, 10, 1.6); under.position.set(0, -.3, 0); inner.add(under);
    root.userData = { inner, wheels, boosts, spot, under, bodyMat, body };
    return root;
  }
  function setPaint(car, key){ const m = car.userData.bodyMat; m.map = T.livery(key); m.needsUpdate = true; }

  /* ---------- traffic ---------- */
  const trafficColors = [0xc9ccd1, 0x1b1d22, 0x8a1c22, 0x2f4f7a, 0xe3e1da, 0x5b6e4f, 0xd0a03a, 0x6a3fa0];
  let trafficGeo = null;
  function trafficGeometries(){
    if (trafficGeo) return trafficGeo;
    const top = curve([[0, .95], [.15, 1.02], [.85, .95], [1, .78]]);
    const body = loft(-2.2, 2.2, t => ({ w: .95 - .1 * smooth(.85, 1, t) - .05 * (1 - smooth(0, .1, t)), yb: .28, yt: top(t), p: .35, tuck: .12 }), 28, 20, .03, .06);
    const ctop = curve([[0, .9], [.2, 1.48], [.75, 1.5], [1, .9]]);
    const cabin = loft(-1.35, .9, t => ({ w: .82, yb: .88, yt: ctop(t), p: .4, tuck: .2 }), 16, 16, .1, .14);
    const wheelG = new THREE.CylinderGeometry(.34, .34, .26, 16); wheelG.rotateZ(Math.PI / 2);
    const ws = [];
    for (const [x, z] of [[-.86, -1.35], [.86, -1.35], [-.86, 1.35], [.86, 1.35]]) ws.push(wheelG.clone().translate(x, .34, z));
    const wheels = THREE.BufferGeometryUtils.mergeBufferGeometries(ws);
    const tails = THREE.BufferGeometryUtils.mergeBufferGeometries([new THREE.BoxGeometry(.38, .1, .05).translate(-.6, .82, -2.2), new THREE.BoxGeometry(.38, .1, .05).translate(.6, .82, -2.2)]);
    return trafficGeo = { body, cabin, wheels, tails };
  }
  const trafficMats = {};
  function trafficCar(){
    const Mt = mats(), G = trafficGeometries();
    const col = trafficColors[(Math.random() * trafficColors.length) | 0];
    const mat = trafficMats[col] || (trafficMats[col] = new THREE.MeshPhysicalMaterial({ color: col, metalness: .55, roughness: .32, clearcoat: .8, clearcoatRoughness: .1, envMapIntensity: 1.1 }));
    const g = new THREE.Group();
    const b = new THREE.Mesh(G.body, mat); b.castShadow = true; g.add(b);
    const c = new THREE.Mesh(G.cabin, Mt.glass); c.castShadow = true; g.add(c);
    g.add(new THREE.Mesh(G.wheels, Mt.tire));
    const tl = new THREE.Mesh(G.tails, Mt.redGlow); g.add(tl);
    for (const s of [-1, 1]){ const f = flareSprite(0xff2a1a, 1.8, .35); f.position.set(s * .6, .82, -2.3); g.add(f); }
    g.userData.brake = tl;
    return { group: g, w: 1.9, l: 4.4, h: 1.5 };
  }
  function truck(){
    const Mt = mats(); const g = new THREE.Group();
    const ci = (Math.random() * 4) | 0;
    const ct = T.container(ci);
    const side = new THREE.MeshStandardMaterial({ map: ct, roughness: .6, metalness: .3 });
    const plain = new THREE.MeshStandardMaterial({ color: [0xc4302b, 0x1e5aa8, 0xe8e8e8, 0x2b2b30][ci], roughness: .6, metalness: .3 });
    side.userData.own = plain.userData.own = true;
    // container: box face order +x,-x,+y,-y,+z,-z
    const cont = new THREE.Mesh(new THREE.BoxGeometry(2.5, 2.7, 7.6), [side, side, plain, plain, plain, plain]);
    cont.position.set(0, 2.05, -.4); cont.castShadow = true; g.add(cont);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.4, 1.9), Mt.darkMetal); cab.position.set(0, 1.6, 4.4); cab.castShadow = true; g.add(cab);
    const ws = box(2.2, 1.0, .05, Mt.glass, 0, 2.2, 5.36); g.add(ws);
    const chassis = box(2.3, .4, 9.6, Mt.darkMetal, 0, .62, .5); g.add(chassis);
    const wheelG = new THREE.CylinderGeometry(.5, .5, .4, 16); wheelG.rotateZ(Math.PI / 2);
    for (const z of [-3.4, -2.3, 3.8]) for (const s of [-1, 1]){ const w = new THREE.Mesh(wheelG, Mt.tire); w.position.set(s * 1.05, .5, z); g.add(w); }
    // hazard bumper + lights
    const bump = box(2.5, .3, .1, Mt.hazard, 0, .7, -4.25); g.add(bump);
    for (const s of [-1, 1]){
      g.add(box(.3, .18, .06, Mt.redGlow, s * 1.0, 1.0, -4.25));
      const f = flareSprite(0xff2a1a, 2.4, .45); f.position.set(s * 1.0, 1.0, -4.35); g.add(f);
      for (let k = 0; k < 4; k++){ g.add(box(.06, .08, .14, Mt.amberGlow, s * 1.26, 3.3, -3.6 + k * 2.2)); }
    }
    g.add(box(2.4, .06, .06, Mt.amberGlow, 0, 3.42, -4.18));
    return { group: g, w: 2.5, l: 9.6, h: 3.45 };
  }

  /* ---------- pickups ---------- */
  let ringGeo = null, discMat = null;
  function ring(){
    const Mt = mats();
    if (!ringGeo){
      ringGeo = new THREE.TorusGeometry(1.9, .14, 14, 56);
      discMat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        uniforms: { time: flameUniforms.time },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
        fragmentShader: `uniform float time; varying vec2 vUv; void main(){ vec2 p = vUv*2.-1.; float r = length(p); float a = atan(p.y,p.x);
          float sw = .5+.5*sin(a*6. + r*14. - time*5.); float edge = smoothstep(1.,.75,r);
          float alpha = (pow(r,3.)*.55 + sw*.08) * edge; gl_FragColor = vec4(vec3(1.,.8,.4)*alpha, alpha); }`
      });
    }
    const g = new THREE.Group();
    const t = new THREE.Mesh(ringGeo, Mt.ring); g.add(t);
    const d = new THREE.Mesh(new THREE.CircleGeometry(1.85, 40), discMat); g.add(d);
    const s = sprite(Mt.glowSprite, 0xffb84a, 5.5); s.material.opacity = .35; g.add(s);
    g.userData.torus = t;
    return g;
  }
  let cellGeo = null;
  function airCell(){
    const Mt = mats();
    if (!cellGeo) cellGeo = { glass: new THREE.CapsuleGeometry ? new THREE.CapsuleGeometry(.42, .9, 6, 16) : new THREE.CylinderGeometry(.42, .42, 1.6, 16), core: new THREE.CylinderGeometry(.16, .16, 1.1, 12), cap: new THREE.CylinderGeometry(.46, .46, .14, 20) };
    const g = new THREE.Group();
    g.add(new THREE.Mesh(cellGeo.core, Mt.cellCore));
    const gl = new THREE.Mesh(cellGeo.glass, Mt.cellGlass); gl.renderOrder = 2; g.add(gl);
    for (const y of [-.62, .62]){ const c = new THREE.Mesh(cellGeo.cap, Mt.nozzle); c.position.y = y; g.add(c); }
    const band = new THREE.Mesh(new THREE.TorusGeometry(.45, .03, 6, 24).rotateX(Math.PI / 2), Mt.cyanGlow); g.add(band);
    const s = sprite(Mt.glowSprite, 0x40d0ff, 4.2); s.material.opacity = .6; g.add(s);
    return g;
  }

  /* ---------- road furniture ---------- */
  function gantry(lines, style){
    const Mt = mats(); const g = new THREE.Group();
    for (const s of [-1, 1]){ const p = box(.3, 8.2, .3, Mt.pole, s * 7.2, 4.1, 0); p.castShadow = true; g.add(p); }
    g.add(box(14.8, .35, .35, Mt.pole, 0, 8, 0));
    const tex = T.sign(lines, { style });
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(7.5, 2.8), new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: .35, roughness: .5 }));
    panel.material.userData.own = true;
    panel.position.set(0, 6.6, -.2); panel.rotation.y = Math.PI; g.add(panel);
    for (const s of [-1, 1]){ const lamp = box(.5, .08, .3, Mt.whiteGlow, s * 2.5, 8.3, -.4); g.add(lamp); }
    return g;
  }
  function lampPost(side){
    const Mt = mats(); const g = new THREE.Group();
    const p = box(.16, 7.5, .16, Mt.pole, 0, 3.75, 0); p.castShadow = true; g.add(p);
    const arm = box(2.2, .12, .12, Mt.pole, -side * 1.05, 7.45, 0); g.add(arm);
    const head = box(.7, .1, .28, Mt.whiteGlow, -side * 2.0, 7.38, 0); g.add(head);
    const s = sprite(Mt.glowSprite, 0xffd9a0, 3.2, -side * 2.0, 7.2, 0); s.material.opacity = .8; g.add(s);
    return g;
  }
  function beacon(){
    const Mt = mats(); const g = new THREE.Group();
    g.add(box(.25, 1.3, .25, Mt.hazard, 0, .65, 0));
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(.16, 10, 8), Mt.redGlow); lamp.position.y = 1.4; g.add(lamp);
    const s = sprite(Mt.glowSprite, 0xff3018, 3.2, 0, 1.4, 0); g.add(s);
    g.userData.blink = s;
    return g;
  }

  /* ---------- scenery ---------- */
  function displace(geo, amt, seed, freq = .2){
    const N = T.makeNoise(seed); const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++){
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const n = N.fbm(x * freq + 50, z * freq + y * freq * .5 + 50, 3, 1000) - .5;
      const r = Math.hypot(x, z) || 1; const k = 1 + n * amt;
      p.setXYZ(i, x * k, y + n * amt * .4, z * k);
    }
    geo.computeVertexNormals(); return geo;
  }
  const sceneryMats = {};
  function smat(key){
    if (sceneryMats[key]) return sceneryMats[key];
    let m;
    if (key === 'rock'){ m = new THREE.MeshStandardMaterial({ map: T.rockStrata(), roughness: .95, metalness: 0, envMapIntensity: .4 }); }
    else if (key === 'cactus'){ m = new THREE.MeshStandardMaterial({ color: 0x3f6b3a, roughness: .8 }); }
    else if (key === 'sand'){ const t = T.sand(); t.repeat.set(30, 3); m = new THREE.MeshStandardMaterial({ map: t, roughness: 1, envMapIntensity: .2 }); }
    else if (key === 'cityground'){ const t = T.cityGround(); t.map.repeat.set(12, 1.2); t.emissiveMap.repeat.set(12, 1.2); m = new THREE.MeshStandardMaterial({ map: t.map, emissiveMap: t.emissiveMap, emissive: 0xffffff, emissiveIntensity: 1.2, roughness: .9 }); }
    else if (key === 'snow'){ const t = T.snow(); t.repeat.set(24, 2.4); m = new THREE.MeshStandardMaterial({ map: t, roughness: .7, envMapIntensity: .6 }); }
    else if (key === 'ice'){ m = new THREE.MeshStandardMaterial({ map: T.ice(), roughness: .35, metalness: .1, envMapIntensity: 1.2 }); }
    else if (key === 'pine'){ m = new THREE.MeshStandardMaterial({ color: 0x1d3a35, roughness: .9 }); }
    else if (key === 'crystal'){ m = new THREE.MeshStandardMaterial({ color: 0x9ffcff, emissive: 0x2ad7ff, emissiveIntensity: 2.2, metalness: .3, roughness: .1, transparent: true, opacity: .9 }); }
    else if (key.startsWith('facade')){ const v = +key.slice(6); const f = T.facade(v); m = new THREE.MeshStandardMaterial({ map: f.map, emissiveMap: f.emissiveMap, emissive: 0xffffff, emissiveIntensity: 1.6, roughness: .5, metalness: .5, envMapIntensity: .8 }); }
    else if (key.startsWith('ad')){ const t = T.billboard(+key.slice(2)); m = new THREE.MeshBasicMaterial({ map: t, color: new THREE.Color(1.6, 1.6, 1.6) }); }
    return sceneryMats[key] = m;
  }
  const geoCache = {};
  function mesa(seed){
    const k = 'mesa' + (seed % 6);
    const g = geoCache[k] || (geoCache[k] = displace(new THREE.CylinderGeometry(.75, 1, 1, 14, 6), .32, 300 + seed % 6, 2.2));
    return new THREE.Mesh(g, smat('rock'));
  }
  function boulder(seed){
    const k = 'boulder' + (seed % 5);
    const g = geoCache[k] || (geoCache[k] = displace(new THREE.IcosahedronGeometry(1, 2), .45, 400 + seed % 5, 1.3));
    return new THREE.Mesh(g, smat('rock'));
  }
  function arch(){
    const g = geoCache.arch || (geoCache.arch = displace(new THREE.TorusGeometry(14, 3.2, 10, 24, Math.PI), .35, 77, .15));
    return new THREE.Mesh(g, smat('rock'));
  }
  function cactus(){
    const m = smat('cactus'); const g = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CapsuleGeometry ? new THREE.CapsuleGeometry(.35, 4.2, 4, 8) : new THREE.CylinderGeometry(.35, .35, 5, 8), m); trunk.position.y = 2.4; g.add(trunk);
    for (const s of [-1, 1]){
      const h = 1.2 + Math.random() * 1.2;
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry ? new THREE.CapsuleGeometry(.25, h, 4, 8) : new THREE.CylinderGeometry(.25, .25, h, 8), m);
      arm.position.set(s * .8, 2.4 + h * .4 + Math.random(), 0); g.add(arm);
      const elbow = new THREE.Mesh(new THREE.CylinderGeometry(.25, .25, .8, 8), m); elbow.rotation.z = Math.PI / 2; elbow.position.set(s * .45, arm.position.y - h / 2, 0); g.add(elbow);
    }
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    return g;
  }
  function building(v, w, h, d){
    const m = smat('facade' + v);
    const geo = new THREE.BoxGeometry(w, h, d);
    // scale uvs so windows keep a constant size (~3.2m per floor)
    const uv = geo.attributes.uv, n = geo.attributes.normal;
    for (let i = 0; i < uv.count; i++){
      const nx = Math.abs(n.getX(i)), ny = Math.abs(n.getY(i));
      const sx = nx > .5 ? d : w; uv.setXY(i, uv.getX(i) * sx / 24, uv.getY(i) * (ny > .5 ? 0 : h / 96));
    }
    return new THREE.Mesh(geo, m);
  }
  function billboard(i){
    const Mt = mats(); const g = new THREE.Group();
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(12, 6), smat('ad' + (i % T.ADS.length))); panel.position.y = 11; g.add(panel);
    const back = box(12.4, 6.4, .3, Mt.darkMetal, 0, 11, -.2); g.add(back);
    g.add(box(.5, 8, .5, Mt.pole, 0, 4, -.3));
    return g;
  }
  function icePeak(seed){
    const k = 'peak' + (seed % 5);
    const g = geoCache[k] || (geoCache[k] = displace(new THREE.ConeGeometry(1, 1.4, 12, 8), .35, 500 + seed % 5, 1.8));
    return new THREE.Mesh(g, smat('ice'));
  }
  function pine(){
    const m = smat('pine'), sn = smat('snow'); const g = new THREE.Group();
    for (let k = 0; k < 3; k++){
      const c = new THREE.Mesh(new THREE.ConeGeometry(1.6 - k * .4, 2.2, 8), k === 2 ? sn : m); c.position.y = 1.6 + k * 1.3; c.castShadow = true; g.add(c);
    }
    return g;
  }
  function crystal(){
    const m = new THREE.Mesh(new THREE.OctahedronGeometry(1, 0), smat('crystal')); m.scale.set(.6, 2.2, .6);
    return m;
  }

  return { mats, loft, playerCar, setPaint, trafficCar, truck, ring, airCell, gantry, lampPost, beacon, mesa, boulder, arch, cactus, building, billboard, icePeak, pine, crystal, smat, flameUniforms, sprite, flareSprite, box };
})();
