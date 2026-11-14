/* ============================================================
   EKANTIK - the fused shell: capsule and band as ONE surface.

   Two meshes laid against each other can only ever show a crease
   where they meet. Instead the whole body is described as a
   signed-distance field: the capsule and the band are blended with
   a smooth union so a fillet grows between them, the finger bore
   is cut through both, and the result is polygonised once.

   Rounded edges, the stadium plan and the fillet are exact
   properties of the field, not approximations in the mesh.
   ============================================================ */

/* ponytail: one cached shell per page; the dimensions never change at
   run time, and every ring on the page shares the same geometry */
let cached = null;

export function fusedShellGeo(THREE, D, baseY) {
  if (cached) return cached;
  cached = buildShell(THREE, D, baseY);
  return cached;
}

function buildShell(THREE, D, baseY) {
  const R0 = D.bandInner, R1 = D.bandInner + D.bandThick;
  const BW = D.bandWidth / 2;
  const HX = D.encB / 2, HZ = D.encL / 2;
  const SEAM = baseY + D.splitY;                 /* where the lid takes over */

  /* the capsule: a stadium plan, rounded by `roll` at its lower edge.
     Built tall and clipped at the seam so only the foot rounds. */
  const ro = D.roll, yb = D.headFoot, yTop = 40;
  const yc = (yb + yTop) / 2, hh = (yTop - yb) / 2;
  const ix = HX - ro, iz = HZ - ro, ir = D.corner - ro;
  const cx = ix - ir, cz = iz - ir;

  const rb = 0.3;                                /* soft edges on the band */
  const smin = (a, b, k) => {
    const h = Math.max(k - Math.abs(a - b), 0) / k;
    return Math.min(a, b) - h * h * k * 0.25;
  };

  const smax = (a, b, k) => -smin(-a, -b, k);

  function sdf(x, y, z) {
    /* capsule */
    const qx = Math.abs(x) - cx, qz = Math.abs(z) - cz;
    const ax = qx > 0 ? qx : 0, az = qz > 0 ? qz : 0;
    const d2 = Math.sqrt(ax * ax + az * az) + Math.min(Math.max(qx, qz), 0) - ir;
    const ey = Math.abs(y - yc) - hh + ro;
    const ex2 = d2 > 0 ? d2 : 0, ey2 = ey > 0 ? ey : 0;
    const head = Math.sqrt(ex2 * ex2 + ey2 * ey2) + Math.min(Math.max(d2, ey), 0) - ro;

    /* band: an annulus about the Z axis, 1mm thick, BW either side */
    const rad = Math.sqrt(x * x + y * y);
    const bx = Math.abs(rad - (R0 + R1) / 2) - D.bandThick / 2 + rb;
    const bz = Math.abs(z) - BW + rb;
    const bx2 = bx > 0 ? bx : 0, bz2 = bz > 0 ? bz : 0;
    const band = Math.sqrt(bx2 * bx2 + bz2 * bz2) + Math.min(Math.max(bx, bz), 0) - rb;

    let d = smin(head, band, D.fuse);            /* the fillet */
    /* the finger hole and the parting line are cut with a small round,
       so the mesh never has to resolve a knife edge (which surface
       nets renders as a serrated rim) */
    d = smax(d, R0 - rad, 0.5);
    return smax(d, y - SEAM, 0.5);
  }

  /* ---- sample the field on a grid ---- */
  const h = D.meshStep;
  const x0 = -HX - 0.6, y0 = -R1 - 0.6, z0 = -HZ - 0.6;
  const nx = Math.ceil((2 * HX + 1.2) / h) + 1;
  const ny = Math.ceil((SEAM + R1 + 1.2) / h) + 1;
  const nz = Math.ceil((2 * HZ + 1.2) / h) + 1;
  const F = new Float32Array(nx * ny * nz);
  const at = (i, j, k) => i + nx * (j + ny * k);

  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++)
        F[at(i, j, k)] = sdf(x0 + i * h, y0 + j * h, z0 + k * h);

  /* ---- surface nets: one vertex per crossed cell ---- */
  const cnx = nx - 1, cny = ny - 1, cnz = nz - 1;
  const cell = new Int32Array(cnx * cny * cnz).fill(-1);
  const cellAt = (i, j, k) => i + cnx * (j + cny * k);
  const pos = [];

  const EDGES = [];
  for (let c = 0; c < 8; c++)
    for (let b = 0; b < 3; b++)
      if (!(c & (1 << b))) EDGES.push([c, c | (1 << b)]);

  const cf = new Float32Array(8);
  for (let k = 0; k < cnz; k++) {
    for (let j = 0; j < cny; j++) {
      for (let i = 0; i < cnx; i++) {
        let neg = 0;
        for (let c = 0; c < 8; c++) {
          const v = F[at(i + (c & 1), j + ((c >> 1) & 1), k + ((c >> 2) & 1))];
          cf[c] = v;
          if (v < 0) neg++;
        }
        if (neg === 0 || neg === 8) continue;

        let sx = 0, sy = 0, sz = 0, n = 0;
        for (const e of EDGES) {
          const fa = cf[e[0]], fb = cf[e[1]];
          if ((fa < 0) === (fb < 0)) continue;
          const t = fa / (fa - fb);
          const ax = e[0] & 1, ay = (e[0] >> 1) & 1, az = (e[0] >> 2) & 1;
          const bx = e[1] & 1, by = (e[1] >> 1) & 1, bz = (e[1] >> 2) & 1;
          sx += ax + (bx - ax) * t;
          sy += ay + (by - ay) * t;
          sz += az + (bz - az) * t;
          n++;
        }
        cell[cellAt(i, j, k)] = pos.length / 3;
        pos.push(x0 + (i + sx / n) * h, y0 + (j + sy / n) * h, z0 + (k + sz / n) * h);
      }
    }
  }

  /* ---- pull each vertex onto the true surface, and take its normal
     from the field, so shading is smooth and edges stay crisp ---- */
  const nrm = new Float32Array(pos.length);
  const eps = 0.02;
  const grad = (x, y, z, out) => {
    out[0] = sdf(x + eps, y, z) - sdf(x - eps, y, z);
    out[1] = sdf(x, y + eps, z) - sdf(x, y - eps, z);
    out[2] = sdf(x, y, z + eps) - sdf(x, y, z - eps);
  };
  const g = [0, 0, 0];

  for (let v = 0; v < pos.length; v += 3) {
    let x = pos[v], y = pos[v + 1], z = pos[v + 2];
    for (let it = 0; it < 2; it++) {
      const f = sdf(x, y, z);
      grad(x, y, z, g);
      const g2 = g[0] * g[0] + g[1] * g[1] + g[2] * g[2] || 1;
      const s = -f * 2 * eps / g2;
      let dx = g[0] * s, dy = g[1] * s, dz = g[2] * s;
      const m = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (m > h) { dx *= h / m; dy *= h / m; dz *= h / m; }
      x += dx; y += dy; z += dz;
    }
    pos[v] = x; pos[v + 1] = y; pos[v + 2] = z;
    grad(x, y, z, g);
    const gl = Math.sqrt(g[0] * g[0] + g[1] * g[1] + g[2] * g[2]) || 1;
    nrm[v] = g[0] / gl; nrm[v + 1] = g[1] / gl; nrm[v + 2] = g[2] / gl;
  }

  /* ---- a quad across every crossed grid edge ---- */
  const idx = [];
  const tri = (a, b, c) => {
    /* wind outward: compare the face against the field's own normals */
    const ux = pos[b * 3] - pos[a * 3], uy = pos[b * 3 + 1] - pos[a * 3 + 1], uz = pos[b * 3 + 2] - pos[a * 3 + 2];
    const vx = pos[c * 3] - pos[a * 3], vy = pos[c * 3 + 1] - pos[a * 3 + 1], vz = pos[c * 3 + 2] - pos[a * 3 + 2];
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    const dot = fx * nrm[a * 3] + fy * nrm[a * 3 + 1] + fz * nrm[a * 3 + 2];
    if (dot >= 0) idx.push(a, b, c); else idx.push(a, c, b);
  };

  const DU = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const q = [0, 0, 0, 0];
  for (let k = 1; k < nz - 1; k++) {
    for (let j = 1; j < ny - 1; j++) {
      for (let i = 1; i < nx - 1; i++) {
        const inside0 = F[at(i, j, k)] < 0;
        for (let a = 0; a < 3; a++) {
          const ni = i + (a === 0 ? 1 : 0), nj = j + (a === 1 ? 1 : 0), nk = k + (a === 2 ? 1 : 0);
          if (ni >= nx || nj >= ny || nk >= nz) continue;
          if (inside0 === (F[at(ni, nj, nk)] < 0)) continue;

          const u = (a + 1) % 3, w = (a + 2) % 3;
          let ok = true;
          for (let m = 0; m < 4; m++) {
            const c = [i, j, k];
            c[u] -= 1 - DU[m][0];
            c[w] -= 1 - DU[m][1];
            if (c[0] < 0 || c[1] < 0 || c[2] < 0 || c[0] >= cnx || c[1] >= cny || c[2] >= cnz) { ok = false; break; }
            q[m] = cell[cellAt(c[0], c[1], c[2])];
            if (q[m] < 0) { ok = false; break; }
          }
          if (!ok) continue;
          tri(q[0], q[1], q[2]);
          tri(q[0], q[2], q[3]);
        }
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  return geo;
}
