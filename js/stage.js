/* ============================================================
   EKANTIK - one 3D stage, three uses on the page.

   hero      assembled, turning slowly, leans toward the pointer
   assemble  parts driven together by a 0..1 progress (scroll)
   design    assembled, shown as it was made: a drawn mesh, a clay
             prototype, then the finished ring (setLook)
   config    assembled, drag to turn, finish can be changed live

   The ring is the real model from ekantik-parts.js: the fused
   capsule and 1mm band, the smoked lid and the live OLED.
   ============================================================ */

import * as THREE from 'three';
import { buildAssembly } from './ekantik-parts.js';

export const FINISHES = {
  midnight: { color: 0x2b2d33, metalness: 0.78, roughness: 0.38 },
  ash:      { color: 0xb3b6bb, metalness: 0.86, roughness: 0.3 },
  sandal:   { color: 0xc49a68, metalness: 0.9,  roughness: 0.28 }
};

/* when each part moves, across the assembly timeline */
const WINDOW = [
  [0.00, 0.34], [0.11, 0.48], [0.17, 0.54], [0.29, 0.66],
  [0.35, 0.72], [0.45, 0.82], [0.58, 0.98]
];

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

/* a pre-dawn sky for reflections: indigo above, saffron at the horizon */
function dawnEnvironment(renderer) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  const sky = g.createLinearGradient(0, 0, 0, 256);
  sky.addColorStop(0, '#1c1a33');
  sky.addColorStop(0.45, '#3a2a3e');
  sky.addColorStop(0.52, '#c9874a');
  sky.addColorStop(0.6, '#2a1d1a');
  sky.addColorStop(1, '#07060a');
  g.fillStyle = sky; g.fillRect(0, 0, 512, 256);
  const soft = g.createRadialGradient(140, 70, 2, 140, 70, 110);
  soft.addColorStop(0, 'rgba(255,240,220,0.95)');
  soft.addColorStop(1, 'rgba(255,240,220,0)');
  g.fillStyle = soft; g.fillRect(0, 0, 512, 256);
  const t = new THREE.CanvasTexture(c);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.colorSpace = THREE.SRGBColorSpace;
  const pm = new THREE.PMREMGenerator(renderer);
  const out = pm.fromEquirectangular(t).texture;
  pm.dispose(); t.dispose();
  return out;
}

export function mountRing(host, opts = {}) {
  const mode = opts.mode || 'hero';
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  host.appendChild(renderer.domElement);
  const el = renderer.domElement;

  const scene = new THREE.Scene();
  /* PMREM textures belong to the renderer that made them */
  scene.environment = dawnEnvironment(renderer);

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 600);
  scene.add(new THREE.AmbientLight(0xfff1e0, 0.35));
  const key = new THREE.DirectionalLight(0xffe2bf, 2.6);
  key.position.set(-18, 30, 26); scene.add(key);
  const rim = new THREE.DirectionalLight(0xe9a54b, 2.4);
  rim.position.set(24, 4, -26); scene.add(rim);
  const fill = new THREE.DirectionalLight(0xb7a6ff, 0.3);
  fill.position.set(10, -20, 18); scene.add(fill);

  const { group, parts, screen, tex } = buildAssembly(THREE);
  const pivot = new THREE.Group();
  pivot.add(group);
  scene.add(pivot);

  const shellMat = parts.find((p) => p.key === 'shell').mesh.material;
  function setFinish(name) {
    const f = FINISHES[name];
    if (!f) return;
    shellMat.color.setHex(f.color);
    shellMat.metalness = f.metalness;
    shellMat.roughness = f.roughness;
  }
  setFinish(opts.finish || 'midnight');

  /* ---- looks for the design story: drawn, shaped, made ---- */
  const INSIDE = ['battery', 'haptic', 'pcb', 'fpc'];
  const wireMat = new THREE.MeshBasicMaterial({
    color: 0xeaa64d, wireframe: true, transparent: true, opacity: 0.16, depthWrite: false
  });
  const clayMat = new THREE.MeshStandardMaterial({ color: 0xcfc6b8, roughness: 0.88, metalness: 0 });
  const meshes = [];
  group.traverse((o) => { if (o.isMesh) { o.userData.real = o.material; meshes.push(o); } });
  let look = 'real';
  function setLook(name) {
    if (name === look) return;
    look = name;
    meshes.forEach((o) => { o.material = name === 'wire' ? wireMat : name === 'clay' ? clayMat : o.userData.real; });
  }
  if (mode === 'design') {
    /* this story is about the outside; the inside stays out of view */
    parts.forEach((p) => { if (INSIDE.includes(p.key)) p.mesh.visible = false; });
    setLook(opts.look || 'wire');
  }

  /* ---- state ---- */
  let t = mode === 'assemble' ? 0 : 1;
  let turn = 0;
  /* yaw 3.7 faces the screen's text upright toward the camera */
  let yaw = 3.7;
  let pitch = 0.5, targetYaw = yaw, targetPitch = pitch;
  let baseYaw = yaw;
  const lean = { x: 0, y: 0 }, leanTarget = { x: 0, y: 0 };
  let dragging = false, lastX = 0, lastY = 0, idle = 0;
  let visible = false, clockT = 0, raf = 0;
  const clock = new THREE.Clock();
  const v = new THREE.Vector3();

  /* ---- input ---- */
  if (mode === 'config' || mode === 'hero') {
    el.style.touchAction = 'pan-y';
    el.style.cursor = 'grab';
    el.addEventListener('pointerdown', (e) => {
      dragging = true; idle = 0; lastX = e.clientX; lastY = e.clientY;
      el.style.cursor = 'grabbing';
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      baseYaw += (e.clientX - lastX) * 0.009;
      targetYaw = baseYaw;
      targetPitch = clamp(targetPitch + (e.clientY - lastY) * 0.005, -0.4, 1.2);
      lastX = e.clientX; lastY = e.clientY;
    });
    const up = () => { dragging = false; el.style.cursor = 'grab'; };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.tabIndex = 0;
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', opts.label || 'The Ekantik ring. Drag or use the arrow keys to turn it.');
    el.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') baseYaw -= 0.25;
      else if (e.key === 'ArrowRight') baseYaw += 0.25;
      else return;
      idle = 0; e.preventDefault();
    });
  }
  if (mode === 'hero' && !reduced) {
    addEventListener('pointermove', (e) => {
      leanTarget.x = (e.clientY / innerHeight - 0.5) * 0.25;
      leanTarget.y = (e.clientX / innerWidth - 0.5) * 0.35;
    }, { passive: true });
  }

  /* ---- framing: assembled the ring spans about 32mm; exploded,
     its parts start up to ~50mm out, so the assembly stage sits wider */
  const HALF = Math.tan((30 * Math.PI / 180) / 2);
  function resize() {
    const w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return;
    camera.aspect = w / h;
    const span = mode === 'assemble' ? 64 : mode === 'design' ? 46 : 50;
    const need = Math.max(span, span / camera.aspect);
    camera.position.set(0, 0, need / (2 * HALF));
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    el.style.width = '100%'; el.style.height = '100%';
  }
  new ResizeObserver(resize).observe(host);
  resize();

  new IntersectionObserver((e) => {
    visible = e[0].isIntersecting;
    if (visible && !raf) { clock.getDelta(); raf = requestAnimationFrame(frame); }
  }, { rootMargin: '120px' }).observe(host);

  function place() {
    parts.forEach((p, i) => {
      const w = WINDOW[i] || [0, 1];
      const local = easeOut(clamp((t - w[0]) / (w[1] - w[0]), 0, 1));
      const m = p.mesh, s = m.userData.spin;
      v.copy(m.userData.from).lerp(m.userData.to, local);
      m.position.copy(v);
      m.rotation.set(s.x * (1 - local), s.y * (1 - local), s.z * (1 - local));
    });
  }

  function frame() {
    raf = 0;
    if (!visible) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.05);
    clockT += dt;

    place();
    /* the screen wakes once the lid is down */
    screen.paint(t > 0.9 && look === 'real' ? clockT : 0);
    tex.needsUpdate = true;

    if (!dragging) idle += dt;
    /* the hero sways so the screen always stays readable; the
       configurator turns all the way round so the band shows too */
    if (mode === 'hero') targetYaw = baseYaw + (reduced ? 0 : 0.55 * Math.sin(clockT * 0.22));
    else if (mode === 'config') { if (!reduced && !dragging && idle > 1.5) baseYaw += dt * 0.22; targetYaw = baseYaw; }
    else if (mode === 'design') targetYaw = 3.0 + (reduced ? 0 : turn * 1.1);
    else targetYaw = 2.9 + (reduced ? 0 : t * 0.8);

    yaw += (targetYaw - yaw) * 0.08;
    pitch += (targetPitch - pitch) * 0.08;
    lean.x += (leanTarget.x - lean.x) * 0.05;
    lean.y += (leanTarget.y - lean.y) * 0.05;
    pivot.rotation.set(pitch + lean.x, yaw + lean.y, 0);
    /* a breath of float, 8s like the rest of the page */
    pivot.position.y = mode === 'assemble' || mode === 'design' || reduced ? 0 : Math.sin(clockT * Math.PI / 4) * 0.8;

    renderer.render(scene, camera);
  }

  return {
    setFinish,
    setLook,
    setProgress(p) { if (mode === 'design') turn = clamp(p, 0, 1); else t = clamp(p, 0, 1); }
  };
}
