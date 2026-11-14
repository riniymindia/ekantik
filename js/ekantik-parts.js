/* ============================================================
   EKANTIK — the assembly, part by part

   Every dimension lives in DIMS, in millimetres, so the model
   can be corrected from one block without touching geometry
   code. The world is oriented the way the ring is worn:

     X  across the finger   (breadth, 18)
     Y  up                  (band below, capsule above)
     Z  along the finger    (length, 30)

   Walls are 1 mm everywhere and the enclosure is held to the
   smallest box the parts actually fit in.
   ============================================================ */

import { FONT_SMALL, FONT_BIG } from './font.js';
import { fusedShellGeo } from './ekantik-shell.js';

export const DIMS = {
  /* enclosure: base and lid combined */
  encL: 32.0, encB: 20.0, encH: 8.4,
  wall: 1.0,
  /* how far the top and bottom edges roll into the sides, so the
     section reads as a pill rather than a slab */
  roll: 2.9,
  /* The ends round off as far as the panel allows: past r = 6.6 the
     14mm display's corners break out through the shell. At 20mm
     breadth that limit is 8.4. */
  corner: 8.4,
  splitY: 6.2,          /* base height; the lid is the remaining 2.2 */

  /* ring band */
  bandInner: 9.0, bandThick: 1.0, bandWidth: 3.0,
  /* where the capsule body stops short of the equator; below that only
     the band continues, and the two are blended into each other */
  headFoot: 1.0, fuse: 1.6, meshStep: 0.22,

  /* display: 0.96in, 64x128 portrait, from the panel drawing */
  panelW: 14.0, panelL: 25.2, panelT: 1.1,
  activeW: 10.86, activeL: 21.74,
  fpcW: 12.4,

  /* board */
  pcbW: 14.0, pcbL: 27.0, pcbT: 0.8,

  /* cell and motor */
  battL: 25.0, battW: 10.0, battH: 4.0,
  hapticD: 7.0, hapticT: 2.0,

  /* capacitive pads: round, on the lid's top face. They reach from
     the edge of the lit area out to the lid's roll, covering the
     panel's black bezel on the way, which costs no pixels. */
  padD: 3.8, padT: 0.28, padZ: 12.9
};

const D = DIMS;

/* the band sits at the origin. The capsule floor IS the band wall
   above the finger, so the enclosure starts at the bore. */
export const BAND_TOP = D.bandInner + D.bandThick;   /* 10.0 */

const baseY = D.bandInner;              /* enclosure underside */
const inFloor = baseY + D.wall;         /* inside floor        */
const battTop = inFloor + D.battH;
const pcbY = battTop + 0.3;
const panelY = pcbY + D.pcbT + 0.2;
const lidY = baseY + D.splitY;          /* clamshell seam      */
const lidTop = baseY + D.encH;

/* ---- geometry helpers ----------------------------------- */

/* a rounded rectangle in plan, extruded upward with a soft edge */
function slab(THREE, w, l, h, r, bevel = 0.3) {
  const b = Math.min(bevel, h / 2 - 0.01, r - 0.01);
  const hw = w / 2 - b, hl = l / 2 - b;
  const rr = Math.min(Math.max(0.01, r - b), hw, hl);
  const x = hw - rr, z = hl - rr;

  /* arcs rather than quadratics: at r = half the breadth the two
     end corners meet and the outline becomes a proper semicircle */
  const s = new THREE.Shape();
  s.absarc(x, z, rr, 0, Math.PI / 2, false);
  s.absarc(-x, z, rr, Math.PI / 2, Math.PI, false);
  s.absarc(-x, -z, rr, Math.PI, Math.PI * 1.5, false);
  s.absarc(x, -z, rr, Math.PI * 1.5, Math.PI * 2, false);

  const geo = new THREE.ExtrudeGeometry(s, {
    depth: h - b * 2,
    bevelEnabled: true,
    bevelThickness: b, bevelSize: b, bevelSegments: 3,
    curveSegments: 22
  });
  geo.rotateX(-Math.PI / 2);
  geo.center();
  return geo;
}

/* the ribbon: out of the panel's lower edge, round the end of the
   stack and back underneath to the board */
function ribbonGeo(THREE) {
  const pos = [], idx = [];
  const steps = 28;
  const z0 = -D.panelL / 2;
  const r = (panelY - pcbY) / 2 + 0.7;
  const midY = (panelY + pcbY + D.pcbT) / 2;
  const hw = D.fpcW / 2;

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = t * Math.PI;
    const y = midY + Math.cos(a) * r;
    const z = z0 - Math.sin(a) * r * 0.9 - 0.3;
    pos.push(-hw, y, z, hw, y, z);
    if (i < steps) {
      const k = i * 2;
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/* ============================================================
   The screen: 128 x 64 LANDSCAPE.

   The 0.96in panel is 64x128 in silicon but the firmware drives
   it on its side, so the long axis runs along the finger. The
   row bands come straight from the firmware layout table:

     header 0-15    rule 16    hero value 19-44
     footer 48-63   progress bar 50-59
     choice rows 16-31, 32-47, 48-63

   Drawn 1:1 into a 128x64 buffer then blitted up with smoothing
   off, so it keeps real pixel edges instead of going soft.
   ============================================================ */
export function makeScreen() {
  const W = 128, H = 64, S = 4;

  const buf = document.createElement('canvas');
  buf.width = W; buf.height = H;
  const b = buf.getContext('2d');

  const c = document.createElement('canvas');
  c.width = W * S; c.height = H * S;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;

  /* a fixed advance per cell keeps the 8x16 / 16x26 grid honest */
  function cells(str, x, y, cw, size, weight) {
    b.font = (weight ? weight + ' ' : '') + size + 'px "DejaVu Sans Mono","Consolas",monospace';
    b.textBaseline = 'top';
    let cx = x;
    for (const ch of String(str)) { b.fillText(ch, cx, y); cx += cw; }
  }
  const body = (t, x, y) => cells(t, x, y, 8, 13);
  const hero = (t, x, y) => cells(t, x, y, 16, 26, 'bold');
  const bodyMid = (t, y) => body(t, Math.round((W - String(t).length * 8) / 2), y + 1);
  const heroMid = (t, y) => hero(t, Math.round((W - String(t).length * 16) / 2), y);

  const rect = (x, y, w, h) => b.fillRect(x, y, w, h);
  const frame = (x, y, w, h) => {
    b.strokeStyle = b.fillStyle; b.lineWidth = 1;
    b.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  };
  const circle = (cx, cy, r) => {
    b.strokeStyle = b.fillStyle; b.lineWidth = 1;
    b.beginPath(); b.arc(cx + 0.5, cy + 0.5, r, 0, Math.PI * 2); b.stroke();
  };

  const header = (t) => { bodyMid(t, 0); rect(6, 16, W - 12, 1); };
  const footer = (t) => bodyMid(t, 48);
  const progress = (pct) => { frame(14, 50, 100, 10); rect(16, 52, Math.round(96 * pct), 6); };
  const battery = (x, y, pct) => {
    frame(x, y, 18, 10);
    rect(x + 18, y + 3, 2, 4);
    rect(x + 2, y + 2, Math.round(14 * pct), 6);
  };

  const p2 = (n) => String(n).padStart(2, '0');
  const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

  const SCREENS = [
    function lock() {
      const n = new Date();
      body(DAYS[n.getDay()], 4, 1);
      battery(W - 24, 2, 0.82);
      frame(60, 4, 9, 7); circle(64, 4, 3);
      heroMid(p2(n.getHours()) + ':' + p2(n.getMinutes()), 19);
      footer(p2(n.getDate()) + '/' + p2(n.getMonth() + 1) + '  3X TO OPEN');
    },
    function mala(t) {
      /* the progress bar takes the footer's rows (50-59), so the
         round total moves up into the header instead */
      header('MALA CH1 /108');
      const count = Math.floor((t * 7) % 108);
      heroMid(String(count), 19);
      progress(count / 108);
    },
    function breathe(t) {
      header('BREATHE');
      const ph = (t / 8) % 1;
      const inhale = ph < 0.5;
      const e = 0.5 - 0.5 * Math.cos((inhale ? ph * 2 : (1 - ph) * 2) * Math.PI);
      const r = 4 + e * 11;
      circle(64, 32, r); circle(64, 32, r - 1);
      body(inhale ? 'INHALE' : 'EXHALE', 4, 25);
      body('BALANCE', W - 60, 25);
      footer('S CANCEL');
    },
    function timer(t) {
      header('TIMER');
      const left = 600 - Math.floor((t * 20) % 600);
      heroMid(p2(Math.floor(left / 60)) + ':' + p2(left % 60), 19);
      progress(1 - left / 600);
    },
    function menu() {
      bodyMid('MENU', 0);
      ['MALA', 'CLOCK', 'BREATHE'].forEach(function (label, i) {
        const y = 16 + i * 16;
        if (i === 0) {
          rect(0, y, W, 16);
          b.fillStyle = '#05070a';
          body(label, 8, y + 1);
          b.fillStyle = '#e8f6ff';
        } else {
          body(label, 8, y + 1);
        }
      });
    },
    function smaran() {
      header('SMARAN');
      body('MALA', 6, 21);
      hero('4212', 56, 19);
      footer('BREATHE 41H   S BACK');
    }
  ];

  function paint(t) {
    b.fillStyle = '#05070a';
    b.fillRect(0, 0, W, H);
    b.fillStyle = '#e8f6ff';
    SCREENS[Math.floor(t / 5) % SCREENS.length](t);
    g.clearRect(0, 0, c.width, c.height);
    g.drawImage(buf, 0, 0, W * S, H * S);
  }

  paint(0);
  return { canvas: c, paint, count: SCREENS.length };
}

/* ---- the assembly --------------------------------------- */
export function buildAssembly(THREE) {
  const group = new THREE.Group();
  const parts = [];

  const add = (key, label, dims, mesh, from, spin) => {
    mesh.userData.to = mesh.position.clone();
    mesh.userData.from = mesh.position.clone().add(from);
    mesh.userData.spin = spin;
    group.add(mesh);
    parts.push({ key, label, dims, mesh });
    return mesh;
  };
  const M = (o) => new THREE.MeshStandardMaterial(o);

  /* 1. base shell and band, fused into one surface */
  const shellMat = M({ color: 0x6e747b, metalness: 0.82, roughness: 0.34 });
  const shell = new THREE.Mesh(fusedShellGeo(THREE, D, baseY), shellMat);


  add('shell', 'Base shell + band',
      D.encL + ' x ' + D.encB + ', fused to a 1 thick band',
      shell, new THREE.Vector3(0, -46, 0), new THREE.Vector3(0.5, 0, 0.3));

  /* 2. battery, against one inner wall */
  const batt = new THREE.Mesh(
    slab(THREE, D.battW, D.battL, D.battH, 1.0, 0.25),
    M({ color: 0x9aa0a6, metalness: 0.85, roughness: 0.35 })
  );
  batt.position.set(-(D.encB / 2 - D.wall - D.battW / 2), inFloor + D.battH / 2, 0);
  add('battery', 'Battery', '180 mAh, 25 x 10 x 4',
      batt, new THREE.Vector3(-48, 6, -6), new THREE.Vector3(0, 0.8, 0.4));

  /* 3. haptic motor, laid flat on the floor in the strip beside the
     cell. At 20mm breadth that strip is 8mm, so the 7mm coin fits and
     stays 5mm below the board instead of pushing up through it. */
  const hap = new THREE.Mesh(
    new THREE.CylinderGeometry(D.hapticD / 2, D.hapticD / 2, D.hapticT, 40),
    M({ color: 0xb08d57, metalness: 0.9, roughness: 0.3 })
  );
  hap.position.set(D.encB / 2 - D.wall - D.hapticD / 2 - 0.3, inFloor + D.hapticT / 2, 0);
  add('haptic', 'Haptic motor', '7 dia x 2, flat',
      hap, new THREE.Vector3(46, 4, 10), new THREE.Vector3(0.6, 0.9, 0));

  /* 4. board */
  const pcb = new THREE.Mesh(
    slab(THREE, D.pcbW, D.pcbL, D.pcbT, 1.2, 0.12),
    M({ color: 0x1d3a2b, metalness: 0.1, roughness: 0.72 })
  );
  pcb.position.set(0, pcbY + D.pcbT / 2, 0);
  add('pcb', 'PCB', '14 x 27 x 0.8',
      pcb, new THREE.Vector3(0, -22, -46), new THREE.Vector3(0.7, 0.3, 0));

  /* 5. ribbon, folded back under the board */
  const fpc = new THREE.Mesh(
    ribbonGeo(THREE),
    M({ color: 0xc08a46, metalness: 0.2, roughness: 0.6, side: THREE.DoubleSide })
  );
  add('fpc', 'Display ribbon', '12.4 wide, folded',
      fpc, new THREE.Vector3(0, -14, -40), new THREE.Vector3(0.4, 0, 0));

  /* 6. display, with the lit area on top */
  const disp = new THREE.Group();
  disp.add(new THREE.Mesh(
    slab(THREE, D.panelW, D.panelL, D.panelT, 0.6, 0.12),
    M({ color: 0x0b0d10, metalness: 0.3, roughness: 0.18 })
  ));

  const screen = makeScreen();
  const tex = new THREE.CanvasTexture(screen.canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  /* landscape: the 128px axis (21.74mm) runs along the finger */
  const actGeo = new THREE.PlaneGeometry(D.activeL, D.activeW);
  actGeo.rotateX(-Math.PI / 2);
  actGeo.rotateY(Math.PI / 2);
  const active = new THREE.Mesh(
    actGeo,
    new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })
  );
  active.position.y = D.panelT / 2 + 0.01;
  disp.add(active);

  disp.position.set(0, panelY + D.panelT / 2, 0);
  add('display', 'Display', '0.96in, 64 x 128, 14 x 25.2',
      disp, new THREE.Vector3(0, 54, 0), new THREE.Vector3(-0.6, 0.4, 0));

  /* 7. transparent lid, carrying the two touch pads on its top face */
  const lid = new THREE.Group();
  const cap = new THREE.Mesh(
    slab(THREE, D.encB, D.encL, D.encH - D.splitY, D.corner, D.roll),
    new THREE.MeshPhysicalMaterial({
      color: 0x05070a, metalness: 0, roughness: 0.04,
      transparent: true, opacity: 0.62,
      clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.3
    })
  );
  cap.position.y = lidY + (D.encH - D.splitY) / 2;
  lid.add(cap);

  /* the two capacitive pads, lying on the lid's top face on the strip
     past each end of the screen, so they read from above */
  const padMat = M({
    color: 0xd8dde2, metalness: 0.45, roughness: 0.4,
    emissive: 0x2d3f52, emissiveIntensity: 0.9
  });
  const padGeo = new THREE.CylinderGeometry(D.padD / 2, D.padD / 2, D.padT, 36);
  for (const sz of [1, -1]) {
    const pad = new THREE.Mesh(padGeo, padMat);
    pad.position.set(0, lidTop + D.padT / 2 - 0.06, sz * D.padZ);
    lid.add(pad);
  }

  add('lid', 'Top lid', 'transparent, on the glass, 2 top pads',
      lid, new THREE.Vector3(0, 42, 34), new THREE.Vector3(-0.5, 0.3, 0.2));

  /* centre the band-to-lid range on the origin so the orbit is tidy */
  group.position.y = -(lidTop - BAND_TOP) / 2;

  return { group, parts, screen, tex };
}
