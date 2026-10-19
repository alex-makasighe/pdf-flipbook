/**
 * Geometri lipatan halaman (page curl) tanpa DOM / jQuery.
 *
 * Koordinat: lokal terhadap satu halaman (slot), (0,0) = pojok kiri-atas halaman.
 *
 * Model fisik: pojok halaman `c` dilipat ke titik `p`. Garis lipatan adalah
 * garis bagi tegak lurus antara c dan p. Sisi yang berisi p tetap menempel
 * (lembar depan), sisi yang berisi c dicerminkan melewati garis (lipatan /
 * sisi belakang kertas).
 */

export type FoldCorner = "tl" | "tr" | "bl" | "br";

export interface Point {
  x: number;
  y: number;
}

export interface FoldInput {
  width: number;
  height: number;
  corner: FoldCorner;
  /** Titik tujuan pojok (koordinat lokal halaman). */
  point: Point;
}

export interface FoldResult {
  /** false bila p == c (belum ada lipatan). */
  active: boolean;
  point: Point;
  /** Ukuran kotak pemotong (clip) dalam px. */
  clipWidth: number;
  clipHeight: number;
  /** Transform untuk kotak clip (overflow hidden), origin 0 0. */
  clip: string;
  /** Transform pengembali posisi untuk lembar depan (W x H), origin 0 0. */
  front: string;
  /** Transform pencerminan untuk lembar lipatan (W x H), origin 0 0. */
  flap: string;
  /** Overlay bayangan pada lembar lipatan, dalam ruang halaman asli. */
  flapShade: { transform: string; width: number; height: number };
  /** Overlay bayangan pada halaman yang terbuka di bawahnya. */
  underShade: { transform: string; width: number; height: number };
  /** 0..1 — seberapa jauh halaman sudah dibalik. */
  progress: number;
  /** Kekuatan bayangan 0..1. */
  strength: number;
}

const DEG = 180 / Math.PI;
const px = (n: number): string => `${Number.isFinite(n) ? +n.toFixed(3) : 0}px`;
const deg = (n: number): string => `${Number.isFinite(n) ? +n.toFixed(4) : 0}deg`;

export function cornerPoint(
  corner: FoldCorner,
  width: number,
  height: number,
): Point {
  return {
    x: corner[1] === "l" ? 0 : width,
    y: corner[0] === "t" ? 0 : height,
  };
}

/** Titik pada punggung buku (sumbu putar) untuk pojok ini. */
export function spinePoint(
  corner: FoldCorner,
  width: number,
  height: number,
): Point {
  return {
    x: corner[1] === "l" ? width : 0,
    y: corner[0] === "t" ? 0 : height,
  };
}

/**
 * Kertas tidak bisa melar: pojok tidak boleh lebih jauh dari `width` dari
 * punggung buku. Titik yang melewati batas diproyeksikan ke lingkaran itu.
 */
export function constrainPoint(
  corner: FoldCorner,
  width: number,
  height: number,
  p: Point,
): Point {
  const s = spinePoint(corner, width, height);
  const dx = p.x - s.x;
  const dy = p.y - s.y;
  const d = Math.hypot(dx, dy);
  if (d <= width || d === 0) return { x: p.x, y: p.y };
  const k = width / d;
  return { x: s.x + dx * k, y: s.y + dy * k };
}

export function calculateFold(input: FoldInput): FoldResult {
  const W = Math.max(1, input.width);
  const H = Math.max(1, input.height);
  const c = cornerPoint(input.corner, W, H);
  const p = constrainPoint(input.corner, W, H, input.point);

  const vx0 = p.x - c.x;
  const vy0 = p.y - c.y;
  const dist = Math.hypot(vx0, vy0);

  const diag = Math.hypot(W, H);
  const clipWidth = diag + W;
  const clipHeight = diag * 2;
  const empty: FoldResult = {
    active: false,
    point: p,
    clipWidth,
    clipHeight,
    clip: "none",
    front: "none",
    flap: "none",
    flapShade: { transform: "none", width: 0, height: 0 },
    underShade: { transform: "none", width: 0, height: 0 },
    progress: 0,
    strength: 0,
  };
  if (dist < 0.5) return empty;

  // v: satuan dari c ke p (menuju sisi yang tetap menempel).
  const vx = vx0 / dist;
  const vy = vy0 / dist;
  const mx = (c.x + p.x) / 2;
  const my = (c.y + p.y) / 2;
  const phi = Math.atan2(vy, vx) * DEG;
  const L = clipHeight;

  // Kotak clip: sumbu-x lokal searah v, menutupi sisi p (x >= 0).
  // local (lx, ly) -> slot: m + R(phi) * (lx, ly - L/2)
  const clip = `translate(${px(mx)}, ${px(my)}) rotate(${deg(phi)}) translate(0px, ${px(-L / 2)})`;

  // Lembar depan: kembalikan koordinat slot ke dalam kotak clip.
  // b = R(-phi)(s - m) + (0, L/2)
  const front = `translate(0px, ${px(L / 2)}) rotate(${deg(-phi)}) translate(${px(-mx)}, ${px(-my)})`;

  // Lipatan: pencerminan melintasi garis lipat, dinyatakan di ruang kotak clip.
  // restore * F = T(0,L/2) * S(-1,1) * R(-phi) * T(-m)
  const flap = `translate(0px, ${px(L / 2)}) scale(-1, 1) rotate(${deg(-phi)}) translate(${px(-mx)}, ${px(-my)})`;

  const shadeW = Math.max(24, Math.min(dist / 2, 230));
  const shadeFrame = (w: number): string =>
    `translate(${px(mx)}, ${px(my)}) rotate(${deg(phi)}) translate(${px(-w)}, ${px(-L / 2)})`;

  const s = spinePoint(input.corner, W, H);
  const maxTravel = Math.max(1, Math.hypot(c.x - s.x, 0) * 2);
  const travel = Math.hypot(p.x - c.x, p.y - c.y);
  const progress = Math.min(1, Math.max(0, travel / maxTravel));
  const strength = Math.min(1, dist / 90);

  return {
    active: true,
    point: p,
    clipWidth,
    clipHeight,
    clip,
    front,
    flap,
    flapShade: { transform: shadeFrame(shadeW), width: shadeW, height: L },
    underShade: { transform: shadeFrame(shadeW * 0.8), width: shadeW * 0.8, height: L },
    progress,
    strength,
  };
}

/** Titik akhir (halaman terbalik sepenuhnya) untuk pojok ini. */
export function endPoint(corner: FoldCorner, width: number, height: number): Point {
  const c = cornerPoint(corner, width, height);
  return { x: corner[1] === "r" ? -width : width * 2, y: c.y };
}
