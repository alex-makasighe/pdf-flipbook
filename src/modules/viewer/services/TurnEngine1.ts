/**
 * Native TypeScript geometry core for a realistic sheet/page-curl flipbook.
 * No DOM, jQuery, or framework dependency. Rendering is handled by Svelte.
 *
 * Coordinate system: local to the page; (0, 0) is its top-left corner.
 */

export type FoldCorner = "tl" | "tr" | "bl" | "br";

export interface Point {
  x: number;
  y: number;
}

export interface FoldInput {
  /** Pointer/fold point in page-local coordinates. */
  point: Point;
  width: number;
  height: number;
  /** Height of the Turn.js-style folding wrapper. */
  wrapperHeight?: number;
  corner: FoldCorner;
  /** Enable the vertical component of the fold. Defaults to true. */
  hasRotation?: boolean;
  /** Whether to calculate dynamic shadow/gradient values. */
  gradients?: boolean;
}

export interface LayerTransform {
  /** CSS transform string, including translate and rotation. */
  transform: string;
  /** CSS transform-origin. */
  origin: string;
  /** Anchoring styles needed by the corresponding layer. */
  anchor: { left: string; top: string; right: string; bottom: string };
}

export interface FoldGeometry {
  corner: FoldCorner;
  angle: number;
  point: Point;
  translation: Point;
  offset: Point;
  pageOffset: number;
  sideWidth: number;
  progress: number;
  layers: {
    sheet: LayerTransform;
    foldedPage: LayerTransform;
    wrapper: LayerTransform;
    foldWrapper: LayerTransform;
  };
  shadow: {
    opacity: number;
    blur: number;
    size: number;
    start: number;
    endA: Point;
    endB: Point | null;
  };
}

const RAD_TO_DEG = 180 / Math.PI;
const DEG_TO_RAD = Math.PI / 180;
const EPSILON = 1e-6;

const round = (n: number): number => Math.round(n);
const clamp = (n: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, n));
const finite = (n: number, fallback = 0): number =>
  Number.isFinite(n) ? n : fallback;
const rotate = (deg: number): string => `rotate(${finite(deg)}deg)`;
const translate = (x: number, y: number): string =>
  `translate3d(${finite(x)}px, ${finite(y)}px, 0)`;

function cornerFlags(corner: FoldCorner) {
  return {
    top: corner[0] === "t",
    left: corner[1] === "l",
  };
}

function cornerPoint(corner: FoldCorner, width: number, height: number): Point {
  const { top, left } = cornerFlags(corner);
  return { x: left ? 0 : width, y: top ? 0 : height };
}

function layerTransform(
  transform: string,
  originX: number,
  originY: number,
  anchors: [number, number, number, number],
): LayerTransform {
  const f = (value: number): string => (value ? "auto" : "0");
  return {
    transform,
    origin: `${originX}% ${originY}%`,
    anchor: {
      left: f(anchors[0]),
      top: f(anchors[1]),
      right: f(anchors[2]),
      bottom: f(anchors[3]),
    },
  };
}

/**
 * Calculate the four independent transforms used by a sheet-curl renderer.
 * The returned transforms must be applied to four distinct DOM layers; putting
 * them all on one element removes the folded-page geometry and is incorrect.
 */
export function calculateFold(input: FoldInput): FoldGeometry {
  const width = Math.max(1, finite(input.width, 1));
  const height = Math.max(1, finite(input.height, 1));
  const wrapperHeight = Math.max(
    1,
    finite(input.wrapperHeight ?? height, height),
  );
  const { top, left } = cornerFlags(input.corner);
  const originCorner = cornerPoint(input.corner, width, height);

  // Clamp only to a generous range: Turn.js permits the dragged point to move
  // outside the page so the curl can continue beyond its edge.
  let p: Point = {
    x: clamp(finite(input.point.x), -width, width * 2),
    y: clamp(finite(input.point.y), -height, height * 2),
  };

  let angle = 0;
  let translation: Point = { x: 0, y: 0 };
  let offset: Point = { x: 0, y: 0 };
  let alpha = 0;
  let sideWidth = width;

  // The source algorithm adjusts the y coordinate when the fold passes 90°.
  // A small bounded iteration prevents pathological input from recursing forever.
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const relX =
      Math.abs(originCorner.x) > EPSILON ? originCorner.x - p.x : p.x;
    const relY =
      input.hasRotation === false
        ? 0
        : Math.abs(originCorner.y) > EPSILON
          ? originCorner.y - p.y
          : p.y;

    const safeRelX =
      Math.abs(relX) < EPSILON ? (relX < 0 ? -EPSILON : EPSILON) : relX;
    const middleX = left ? width - relX / 2 : p.x + relX / 2;
    const middleY = relY / 2;
    alpha = Math.PI / 2 - Math.atan2(relY, safeRelX);
    const gamma = alpha - Math.atan2(middleY, middleX || EPSILON);
    const distance = Math.max(
      0,
      Math.sin(gamma) * Math.hypot(middleX, middleY),
    );

    translation = {
      x: distance * Math.sin(alpha),
      y: distance * Math.cos(alpha),
    };

    if (alpha <= Math.PI / 2) break;

    translation.x += Math.abs((translation.y * relY) / safeRelX);
    translation.y = 0;
    const candidate = translation.x * Math.tan(Math.PI - alpha);
    if (Math.round(candidate) >= height) break;

    const radicand = height * height + 2 * middleX * relX;
    if (radicand < 0 || !Number.isFinite(radicand)) break;
    const adjustedY = Math.sqrt(radicand);
    p.y = top ? height - adjustedY : adjustedY;
  }

  angle = finite(alpha * RAD_TO_DEG);
  const safeTan =
    Math.abs(Math.tan(alpha)) < EPSILON
      ? Math.tan(alpha) < 0
        ? -EPSILON
        : EPSILON
      : Math.tan(alpha);

  let move: Point = { x: 0, y: 0 };
  if (alpha > Math.PI / 2) {
    const beta = Math.PI - alpha;
    const denominator = Math.sin(beta);
    const distance =
      wrapperHeight -
      height / (Math.abs(denominator) < EPSILON ? EPSILON : denominator);
    move = {
      x: round(distance * Math.cos(beta)),
      y: round(distance * Math.sin(beta)),
    };
    if (left) move.x *= -1;
    if (top) move.y *= -1;
  }

  const px = round(translation.y / safeTan + translation.x);
  sideWidth = width - px;
  const sideX = sideWidth * Math.cos(alpha * 2);
  const sideY = sideWidth * Math.sin(alpha * 2);
  offset = {
    x: round(left ? sideWidth - sideX : px + sideX),
    y: round(top ? sideY : height - sideY),
  };
  translation = { x: round(translation.x), y: round(translation.y) };

  const cornerConfig: Record<
    FoldCorner,
    {
      trX: number;
      trY: number;
      anchors: [number, number, number, number];
      originX: number;
      originY: number;
      angleSign: 1 | -1;
    }
  > = {
    tl: {
      trX: translation.x,
      trY: translation.y,
      anchors: [1, 0, 0, 1],
      originX: 100,
      originY: 0,
      angleSign: 1,
    },
    tr: {
      trX: -translation.x,
      trY: translation.y,
      anchors: [0, 0, 0, 1],
      originX: 0,
      originY: 0,
      angleSign: -1,
    },
    bl: {
      trX: translation.x,
      trY: -translation.y,
      anchors: [1, 1, 0, 0],
      originX: 100,
      originY: 100,
      angleSign: -1,
    },
    br: {
      trX: -translation.x,
      trY: -translation.y,
      anchors: [0, 1, 1, 0],
      originX: 0,
      originY: 100,
      angleSign: 1,
    },
  };
  const config = cornerConfig[input.corner];
  const a = angle * config.angleSign;
  const tx = config.trX;
  const ty = config.trY;
  const originX = config.originX;
  const originY = config.originY;
  const xPercent = originX / 100;
  const yPercent = originY / 100;
  const mvW = (width - wrapperHeight) * xPercent;
  const mvH = (height - wrapperHeight) * yPercent;
  const aliasingFix = a !== 90 && a !== -90 ? (left ? -1 : 1) : 0;
  const translateSheet = translate(tx + aliasingFix, ty);
  const translateFolded = translate(
    tx + offset.x - move.x - width * xPercent,
    ty + offset.y - move.y - height * yPercent,
  );
  const translateWrapper = translate(-tx + mvW - aliasingFix, -ty + mvH);
  const translateFoldWrapper = translate(
    -tx + move.x + mvW,
    -ty + move.y + mvH,
  );

  const foldedRotation = a === 0 ? 0 : (180 / a - 2) * a;
  const layers = {
    sheet: layerTransform(
      `${rotate(a)} ${translateSheet}`,
      originX,
      originY,
      config.anchors,
    ),
    foldedPage: layerTransform(
      `${rotate(a)} ${translateFolded} ${rotate(foldedRotation)}`,
      originX,
      originY,
      config.anchors,
    ),
    wrapper: layerTransform(
      `${translateWrapper} ${rotate(-a)}`,
      originX,
      originY,
      config.anchors,
    ),
    foldWrapper: layerTransform(
      `${translateFoldWrapper} ${rotate(-a)}`,
      originX,
      originY,
      config.anchors,
    ),
  };

  const corner = cornerPoint(input.corner, width, height);
  const distanceToCorner = Math.hypot(corner.x - p.x, corner.y - p.y);
  const far = distanceToCorner / width;
  const shadowStrength = Math.sin((Math.PI / 2) * (far > 1 ? 2 - far : far));
  const gradientSize = sideWidth * Math.sin(alpha);
  const gradientEndA = {
    x: ((gradientSize * Math.sin(alpha)) / width) * 100,
    y: ((gradientSize * Math.cos(alpha)) / height) * 100,
  };
  const gradientEndB =
    input.gradients === false
      ? null
      : {
          x:
            (((left ? 1 : -1) * gradientSize * 1.2 * Math.sin(alpha)) / width) *
              100 +
            (left ? 0 : 100),
          y:
            (((top ? 1 : -1) * gradientSize * 1.2 * Math.cos(alpha)) / height) *
              100 +
            (top ? 0 : 100),
        };

  return {
    corner: input.corner,
    angle,
    point: p,
    translation,
    offset,
    pageOffset: px,
    sideWidth,
    progress: clamp(1 - Math.abs(p.x - corner.x) / width, 0, 1),
    layers,
    shadow: {
      opacity: clamp(Math.min(far, 1) * shadowStrength, 0, 1),
      blur: 20 * clamp(shadowStrength, 0, 1),
      size: Math.max(0, finite(gradientSize)),
      start: gradientSize > 100 ? (gradientSize - 100) / gradientSize : 0,
      endA: { x: finite(gradientEndA.x), y: finite(gradientEndA.y) },
      endB: gradientEndB
        ? { x: finite(gradientEndB.x), y: finite(gradientEndB.y) }
        : null,
    },
  };
}
