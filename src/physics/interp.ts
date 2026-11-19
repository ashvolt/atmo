/** Piecewise-linear interpolation on a sorted abscissa; clamps outside the range. */
export function interpLinear(xs: ArrayLike<number>, ys: ArrayLike<number>, x: number): number {
  const n = xs.length;
  if (x <= xs[0]) return ys[0];
  if (x >= xs[n - 1]) return ys[n - 1];
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid;
    else hi = mid;
  }
  const w = (x - xs[lo]) / (xs[hi] - xs[lo]);
  return ys[lo] + w * (ys[hi] - ys[lo]);
}

/** Bilinear interpolation on a regular lat/lon grid stored row-major from lat0 (south) upward. */
export function bilinearGrid(
  data: ArrayLike<number>,
  nLon: number,
  nLat: number,
  lat0: number,
  lon0: number,
  dLat: number,
  dLon: number,
  latDeg: number,
  lonDeg: number,
  wrapLon = true,
): number {
  let x = (lonDeg - lon0) / dLon;
  const y = Math.min(Math.max((latDeg - lat0) / dLat, 0), nLat - 1);
  if (wrapLon) x = ((x % nLon) + nLon) % nLon;
  else x = Math.min(Math.max(x, 0), nLon - 1);
  const i0 = Math.floor(x);
  const j0 = Math.min(Math.floor(y), nLat - 2);
  const i1 = wrapLon ? (i0 + 1) % nLon : Math.min(i0 + 1, nLon - 1);
  const fx = x - i0;
  const fy = y - j0;
  const a = data[j0 * nLon + i0];
  const b = data[j0 * nLon + i1];
  const c = data[(j0 + 1) * nLon + i0];
  const d = data[(j0 + 1) * nLon + i1];
  return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
}
