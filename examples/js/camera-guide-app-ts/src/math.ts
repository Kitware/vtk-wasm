/** Small vector / plane / matrix helpers shared by the gizmo and the panel. */

export type Vec3 = [number, number, number];
/** Plane `a x + b y + c z + d = 0`. */
export type Plane = [number, number, number, number];

export function v3(a: ArrayLike<number>): Vec3 {
  return [a[0], a[1], a[2]];
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function length(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

export function normalize(a: Vec3): Vec3 {
  const l = length(a);
  return l > 0 ? scale(a, 1 / l) : [0, 0, 0];
}

export function lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Point where three planes meet (Cramer's rule); `null` if nearly coplanar. */
export function intersectPlanes(p: Plane, q: Plane, r: Plane): Vec3 | null {
  const np: Vec3 = [p[0], p[1], p[2]];
  const nq: Vec3 = [q[0], q[1], q[2]];
  const nr: Vec3 = [r[0], r[1], r[2]];
  const det = dot(np, cross(nq, nr));
  if (Math.abs(det) < 1e-12) {
    return null;
  }
  const term1 = scale(cross(nq, nr), -p[3]);
  const term2 = scale(cross(nr, np), -q[3]);
  const term3 = scale(cross(np, nq), -r[3]);
  return scale(add(add(term1, term2), term3), 1 / det);
}

/** Plane indices in `vtkCamera::GetFrustumPlanes` order: -x, +x, -y, +y, -z, +z. */
export const enum PlaneIndex {
  Left = 0,
  Right = 1,
  Bottom = 2,
  Top = 3,
  Near = 4,
  Far = 5,
}

/** Three planes meeting at each corner: near BL, BR, TR, TL, then far. */
const CORNER_PLANES: ReadonlyArray<readonly [number, number, number]> = [
  [PlaneIndex.Near, PlaneIndex.Bottom, PlaneIndex.Left],
  [PlaneIndex.Near, PlaneIndex.Bottom, PlaneIndex.Right],
  [PlaneIndex.Near, PlaneIndex.Top, PlaneIndex.Right],
  [PlaneIndex.Near, PlaneIndex.Top, PlaneIndex.Left],
  [PlaneIndex.Far, PlaneIndex.Bottom, PlaneIndex.Left],
  [PlaneIndex.Far, PlaneIndex.Bottom, PlaneIndex.Right],
  [PlaneIndex.Far, PlaneIndex.Top, PlaneIndex.Right],
  [PlaneIndex.Far, PlaneIndex.Top, PlaneIndex.Left],
];

export function planeAt(planes: ArrayLike<number>, index: number): Plane {
  const o = index * 4;
  return [planes[o], planes[o + 1], planes[o + 2], planes[o + 3]];
}

/** The eight frustum corners from the 24 plane coefficients, or `null` if degenerate. */
export function frustumCorners(planes: ArrayLike<number>): Vec3[] | null {
  if (planes.length < 24) {
    return null;
  }
  const corners: Vec3[] = [];
  for (const [a, b, c] of CORNER_PLANES) {
    const point = intersectPlanes(planeAt(planes, a), planeAt(planes, b), planeAt(planes, c));
    if (!point || !point.every(Number.isFinite)) {
      return null;
    }
    corners.push(point);
  }
  return corners;
}

/** Frustum planes from a row-major world->clip matrix, matching GetFrustumPlanes order. */
export function planesFromCompositeMatrix(m: ArrayLike<number>): number[] {
  const row = (i: number): Plane => [m[4 * i], m[4 * i + 1], m[4 * i + 2], m[4 * i + 3]];
  const r0 = row(0);
  const r1 = row(1);
  const r2 = row(2);
  const r3 = row(3);
  const combine = (r: Plane, sign: 1 | -1): number[] => {
    const plane: Plane = [r3[0] + sign * r[0], r3[1] + sign * r[1], r3[2] + sign * r[2], r3[3] + sign * r[3]];
    const n = Math.hypot(plane[0], plane[1], plane[2]);
    return n > 0 ? plane.map((v) => v / n) : plane;
  };
  return [
    ...combine(r0, 1), // -x (left)
    ...combine(r0, -1), // +x (right)
    ...combine(r1, 1), // -y (bottom)
    ...combine(r1, -1), // +y (top)
    ...combine(r2, 1), // -z (near)
    ...combine(r2, -1), // +z (far)
  ];
}

/** Two unit vectors perpendicular to `dir` and to each other. */
export function perpendicularBasis(dir: Vec3): [Vec3, Vec3] {
  const helper: Vec3 = Math.abs(dir[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const p1 = normalize(cross(dir, helper));
  const p2 = normalize(cross(dir, p1));
  return [p1, p2];
}

/** Row-major matrix placing a unit +x vtkArrowSource at `origin`, pointing along `dir`. */
export function arrowMatrix(origin: Vec3, dir: Vec3, length: number, thickness: number): number[] {
  const d = normalize(dir);
  const [p1, p2] = perpendicularBasis(d);
  const c0 = scale(d, length);
  const c1 = scale(p1, thickness);
  const c2 = scale(p2, thickness);
  return [
    c0[0], c1[0], c2[0], origin[0],
    c0[1], c1[1], c2[1], origin[1],
    c0[2], c1[2], c2[2], origin[2],
    0, 0, 0, 1,
  ];
}

/** Multiply a row-major 4x4 with a homogeneous point. */
export function transformPoint(m: ArrayLike<number>, p: Vec3): [number, number, number, number] {
  const x = p[0];
  const y = p[1];
  const z = p[2];
  return [
    m[0] * x + m[1] * y + m[2] * z + m[3],
    m[4] * x + m[5] * y + m[6] * z + m[7],
    m[8] * x + m[9] * y + m[10] * z + m[11],
    m[12] * x + m[13] * y + m[14] * z + m[15],
  ];
}

export function fmt(n: number, digits = 3): string {
  if (!Number.isFinite(n)) {
    return String(n);
  }
  const s = n.toFixed(digits);
  // Avoid "-0.000".
  return Number(s) === 0 ? (0).toFixed(digits) : s;
}

export function fmtVec(v: ArrayLike<number>, digits = 3): string {
  return Array.from(v, (x) => fmt(x, digits)).join(", ");
}

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}
