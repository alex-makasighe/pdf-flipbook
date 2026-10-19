<script lang="ts">
  import { onDestroy, tick } from "svelte";
  import { FlipBookService } from "../services/FlipBookService";
  import { PdfService } from "../services/PdfService";
  import { PdfRenderCache } from "../services/PdfRenderCache";
  import type { FlipDirection } from "../types/viewer.types";
  import {
    calculateFold,
    cornerPoint,
    endPoint,
    type FoldCorner,
    type Point,
  } from "../services/TurnEngine";

  interface Props {
    pdfUrl: string;
    page: number;
    zoom: number;
    onPageChange: (page: number) => void;
    onPageCount: (count: number) => void;
    onPdfReady: (service: PdfService) => void;
  }

  let { pdfUrl, page, zoom, onPageChange, onPageCount, onPdfReady }: Props =
    $props();

  const flipService = new FlipBookService();
  const pdfService = new PdfService();
  const cache = new PdfRenderCache(pdfService, 8);

  let host = $state<HTMLDivElement | null>(null);

  // Hindari render ulang setelah commitFlip menyiapkan canvas tujuan.
  let skipNextPageRender = false;

  let leftCanvas = $state<HTMLCanvasElement | null>(null);
  let rightCanvas = $state<HTMLCanvasElement | null>(null);

  /*
   * Canvas khusus untuk halaman yang sedang dibalik.
   *
   * Front:
   *   halaman yang sedang terlihat dan dibalik
   *
   * Back:
   *   halaman tujuan setelah flip
   */
  let turnFrontCanvas = $state<HTMLCanvasElement | null>(null);
  let turnBackCanvas = $state<HTMLCanvasElement | null>(null);

  let loading = $state(true);
  let error = $state("");
  let mobile = $state(false);

  let flipping = false;
  let coverOpening = $state(false);

  // Layer lipatan (diatur langsung lewat style agar tidak memicu reaktivitas).
  let turnSlot = $state<HTMLDivElement | null>(null);
  let underBox = $state<HTMLDivElement | null>(null);
  let underShade = $state<HTMLDivElement | null>(null);
  let clipLayer = $state<HTMLDivElement | null>(null);
  let frontLayer = $state<HTMLDivElement | null>(null);
  let flapLayer = $state<HTMLDivElement | null>(null);
  let flapShade = $state<HTMLDivElement | null>(null);

  function updateMobile(): void {
    mobile = window.matchMedia("(max-width: 767px)").matches;
  }

  // function isOddFinalSpread(current: number): boolean {
  //   return (
  //     !mobile &&
  //     pdfService.numPages > 1 &&
  //     pdfService.numPages % 2 === 1 &&
  //     current === pdfService.numPages - 1
  //   );
  // }

  function isOddFinalSpread(current: number): boolean {
    return (
      !mobile &&
      pdfService.numPages > 1 &&
      pdfService.numPages % 2 === 0 &&
      current === pdfService.numPages - 1
    );
  }

  function spreadStart(current: number): number {
    if (mobile || isCoverPage(current)) {
      return current;
    }

    if (isOddFinalSpread(current)) {
      return current;
    }

    return current % 2 === 0 ? current - 1 : current;
  }

  function spreadEnd(current: number): number {
    if (mobile || isCoverPage(current)) {
      return current;
    }

    if (isOddFinalSpread(current)) {
      return pdfService.numPages + 1;
    }

    return current % 2 === 0 ? current : current + 1;
  }

  function nextPage(current: number): number {
    if (mobile) {
      return flipService.next(current, pdfService.numPages, true);
    }

    const total = pdfService.numPages;

    // Sampul depan: buka langsung ke spread halaman 1–2.
    if (current === 1) {
      return total > 1 ? 2 : current;
    }

    // Sampul belakang tidak bisa dilanjutkan.
    if (current === total) {
      return current;
    }

    // Spread terakhir dengan sisi kanan kosong.
    if (isOddFinalSpread(current)) {
      return total;
    }

    // Menuju halaman terakhir sebelum sampul belakang.
    if (total % 2 === 0 && current === total - 2) {
      return total - 1;
    }

    if (current === total - 1) {
      return total;
    }

    return Math.min(current + 2, total);
  }

  function previousPage(current: number): number {
    if (mobile) {
      return flipService.previous(current, pdfService.numPages, true);
    }

    const total = pdfService.numPages;

    // Sudah berada di sampul depan.
    if (current === 1) {
      return current;
    }

    // Dari sampul belakang kembali ke spread terakhir.
    if (current === total) {
      return total - 1;
    }

    // Dari spread pertama kembali ke sampul depan.
    if (current === 2) {
      return 1;
    }

    return Math.max(current - 2, 1);
  }

  // Sampul depan dan belakang tampil sebagai satu halaman di tengah.
  function isCoverPage(current: number): boolean {
    return (
      !mobile &&
      (current === 1 ||
        (pdfService.numPages > 0 && current === pdfService.numPages))
    );
  }

  function calculateScale(): number {
    const width = host?.clientWidth ?? 1000;

    const targetWidth = mobile ? width * 0.82 : width * 0.39;

    return Math.min(1.6, Math.max(0.65, targetWidth / 700)) * zoom;
  }

  async function renderPage(
    pageNumber: number,
    canvas: HTMLCanvasElement | null,
    scale: number,
  ): Promise<void> {
    if (!canvas || pageNumber < 1 || pageNumber > pdfService.numPages) {
      return;
    }

    await cache.render(pageNumber, scale, canvas);
  }

  async function preloadAround(current: number, scale: number): Promise<void> {
    const pages = mobile
      ? [current - 1, current + 1, current + 2]
      : [
          spreadStart(current) - 2,
          spreadStart(current) - 1,
          spreadEnd(current) + 1,
          spreadEnd(current) + 2,
        ];

    for (const pageNumber of pages) {
      if (pageNumber >= 1 && pageNumber <= pdfService.numPages) {
        void cache.preload(pageNumber, scale);
      }
    }
  }
  function clearCanvas(canvas: HTMLCanvasElement | null): void {
    if (!canvas) return;
    const context = canvas.getContext("2d");
    context?.clearRect(0, 0, canvas.width, canvas.height);
    canvas.width = 0;
    canvas.height = 0;
  }

  async function renderCurrent(): Promise<void> {
    if (!pdfService.isLoaded) {
      return;
    }
    loading = true;
    error = "";
    try {
      const scale = calculateScale();
      if (mobile || isCoverPage(page)) {
        await renderPage(page, rightCanvas, scale);
        if (!mobile && leftCanvas) {
          clearCanvas(leftCanvas);
        }
      } else {
        const left = spreadStart(page);
        const right = spreadEnd(page);

        await renderPage(left, leftCanvas, scale);
        if (right > pdfService.numPages) {
          clearCanvas(rightCanvas);
        } else {
          await renderPage(right, rightCanvas, scale);
        }
      }
      loading = false;
      void preloadAround(page, scale);
    } catch (err) {
      loading = false;
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }
      error = err instanceof Error ? err.message : "Gagal merender PDF.";
    }
  }

  /* =========================================================
     PAGE CURL (sheet effect)

     Struktur layer (satu "slot" seukuran halaman yang dibalik):

       .turn-slot
         .turn-under            bayangan di halaman yang terbuka
         .turn-clip             overflow:hidden, diputar sejajar garis lipat
           .turn-front          lembar depan (diputar balik -> posisi asli)
           .turn-flap           sisi belakang kertas (dicerminkan di garis lipat)

     Semua matematika ada di TurnEngine.ts (calculateFold).
  ========================================================= */

  interface TurnSession {
    direction: FlipDirection;
    target: number;
    side: "left" | "right";
    corner: FoldCorner;
    /** Halaman yang tampil di sisi belakang lembar (null = kertas kosong). */
    backPage: number | null;
    /** Halaman yang terbuka di bawah lembar (null = kosong). */
    underPage: number | null;
    openingCover: boolean;
    targetSingle: boolean;
    underCanvas: HTMLCanvasElement;
    prep: Promise<void> | null;
    activation: Promise<void> | null;
    activated: boolean;
    peeled: boolean;
    anim: Promise<void> | null;
    slotW: number;
    slotH: number;
    p: Point | null;
  }

  interface DragState {
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    prevX: number;
    prevT: number;
    vx: number;
    direction: FlipDirection;
    cornerV: "t" | "b";
    started: boolean;
    starting: Promise<void> | null;
    session: TurnSession | null;
    base: Point | null;
  }

  let session: TurnSession | null = null;
  let drag: DragState | null = null;
  let suppressNextClick = false;
  let hoverKey = "";

  const px = (n: number): string => `${n}px`;

  function easeInOutCubic(t: number): number {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function copyCanvas(
    source: HTMLCanvasElement | null,
    target: HTMLCanvasElement | null,
  ): void {
    if (!source || !target) return;
    if (source.width === 0 || source.height === 0) return;

    target.width = source.width;
    target.height = source.height;

    const context = target.getContext("2d");
    if (!context) return;

    context.clearRect(0, 0, target.width, target.height);
    context.drawImage(source, 0, 0);
  }

  function paint(
    canvas: HTMLCanvasElement | null,
    source: HTMLCanvasElement | null,
  ): void {
    if (source) copyCanvas(source, canvas);
    else clearCanvas(canvas);
  }

  function frontCanvasFor(s: TurnSession): HTMLCanvasElement | null {
    if (mobile || isCoverPage(page)) return rightCanvas;
    return s.side === "right" ? rightCanvas : leftCanvas;
  }

  function planTurn(
    direction: FlipDirection,
    cornerV: "t" | "b",
  ): TurnSession | null {
    if (!pdfService.isLoaded) return null;

    const total = pdfService.numPages;
    const target = direction === "next" ? nextPage(page) : previousPage(page);
    if (target === page || target < 1 || target > total) return null;

    const inRange = (n: number): number | null =>
      n >= 1 && n <= total ? n : null;

    const openingCover =
      !mobile &&
      ((page === 1 && direction === "next") ||
        (page === total && direction === "previous"));
    const targetSingle = mobile || isCoverPage(target);
    const side: "left" | "right" = direction === "next" ? "right" : "left";

    let backPage: number | null;
    let underPage: number | null;

    if (mobile) {
      // Mode satu halaman: sisi belakang kertas kosong, halaman tujuan
      // langsung terlihat di bawah lembar.
      backPage = null;
      underPage = target;
    } else if (direction === "next") {
      // Lembar kanan dibalik: sisi belakangnya = halaman kiri spread tujuan,
      // halaman yang terbuka di bawahnya = halaman kanan spread tujuan.
      backPage = inRange(spreadStart(target));
      underPage = targetSingle ? null : inRange(spreadEnd(target));
    } else {
      backPage = inRange(spreadEnd(target));
      underPage = targetSingle ? null : inRange(spreadStart(target));
    }

    return {
      direction,
      target,
      side,
      corner: `${cornerV}${side === "right" ? "r" : "l"}` as FoldCorner,
      backPage,
      underPage,
      openingCover,
      targetSingle,
      underCanvas: document.createElement("canvas"),
      prep: null,
      activation: null,
      activated: false,
      peeled: false,
      anim: null,
      slotW: 0,
      slotH: 0,
      p: null,
    };
  }

  /** Render sisi belakang + halaman di bawah lembar; belum mengubah tampilan. */
  async function prepareSession(s: TurnSession): Promise<void> {
    copyCanvas(frontCanvasFor(s), turnFrontCanvas);

    const scale = calculateScale();
    const tasks: Promise<void>[] = [];

    if (s.backPage !== null) {
      tasks.push(renderPage(s.backPage, turnBackCanvas, scale));
    } else {
      clearCanvas(turnBackCanvas);
    }
    if (s.underPage !== null) {
      tasks.push(renderPage(s.underPage, s.underCanvas, scale));
    }
    await Promise.all(tasks);
  }

  async function ensureSession(
    direction: FlipDirection,
    cornerV: "t" | "b",
  ): Promise<TurnSession | null> {
    if (session && session.direction !== direction) {
      if (session.anim) return null;
      restoreTurn(session);
    }

    if (!session) session = planTurn(direction, cornerV);
    const s = session;
    if (!s) return null;

    if (!s.activated) {
      s.corner = `${cornerV}${s.side === "right" ? "r" : "l"}` as FoldCorner;
    }
    s.prep ??= prepareSession(s);
    try {
      await s.prep;
    } catch (err) {
      if (session === s) session = null;
      throw err;
    }

    return session === s ? s : null;
  }

  function slotElement(
    s: TurnSession,
    spread: HTMLElement,
  ): HTMLElement | null {
    if (mobile) {
      return (
        spread.querySelector<HTMLElement>(".single-page") ??
        spread.querySelector<HTMLElement>(".page-sheet")
      );
    }
    return spread.querySelector<HTMLElement>(
      s.side === "right" ? ".right-page" : ".left-page",
    );
  }

  /** Posisikan slot tepat di atas halaman yang dibalik (area isi, tanpa border). */
  function measureSlot(s: TurnSession): boolean {
    const spread = host?.querySelector<HTMLElement>(".book-spread");
    if (!spread || !turnSlot) return false;
    const el = slotElement(s, spread);
    if (!el) return false;

    const sr = spread.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const bx = el.clientLeft;
    const by = el.clientTop;
    const w = Math.max(1, r.width - bx * 2);
    const h = Math.max(1, r.height - by * 2);

    turnSlot.style.left = px(r.left + bx - sr.left);
    turnSlot.style.top = px(r.top + by - sr.top);
    turnSlot.style.width = px(w);
    turnSlot.style.height = px(h);
    s.slotW = w;
    s.slotH = h;
    return true;
  }

  function setBox(
    el: HTMLElement | null,
    w: number,
    h: number,
    transform: string,
  ): void {
    if (!el) return;
    el.style.width = px(w);
    el.style.height = px(h);
    el.style.transform = transform;
  }

  /** Terapkan satu frame lipatan untuk titik pojok `point`. */
  function renderFold(s: TurnSession, point: Point): void {
    if (!measureSlot(s)) return;
    const W = s.slotW;
    const H = s.slotH;
    const right = s.corner[1] === "r";
    const bottom = s.corner[0] === "b";
    const c = cornerPoint(s.corner, W, H);

    // Pojok hanya boleh bergerak ke arah dalam halaman.
    let x = right ? Math.min(point.x, c.x) : Math.max(point.x, c.x);
    let y = bottom ? Math.min(point.y, c.y) : Math.max(point.y, c.y);
    if (Math.hypot(x - c.x, y - c.y) < 1) {
      x = c.x + (right ? -0.8 : 0.8);
      y = c.y + (bottom ? -0.8 : 0.8);
    }

    const g = calculateFold({
      width: W,
      height: H,
      corner: s.corner,
      point: { x, y },
    });
    s.p = g.point;

    if (clipLayer) {
      clipLayer.style.width = px(g.clipWidth);
      clipLayer.style.height = px(g.clipHeight);
      clipLayer.style.transform = g.clip;
    }
    setBox(frontLayer, W, H, g.front);
    setBox(flapLayer, W, H, g.flap);
    setBox(
      flapShade,
      g.flapShade.width,
      g.flapShade.height,
      g.flapShade.transform,
    );
    setBox(underBox, W, H, "none");
    setBox(
      underShade,
      g.underShade.width,
      g.underShade.height,
      g.underShade.transform,
    );

    if (flapShade) flapShade.style.opacity = String(g.strength);
    if (underShade) underShade.style.opacity = String(g.strength);
  }

  function animateFold(
    s: TurnSession,
    from: Point,
    to: Point,
    duration: number,
    lift: number,
  ): Promise<void> {
    return new Promise<void>((resolve) => {
      const started = performance.now();
      const frame = (now: number) => {
        const t = Math.min(1, Math.max(0, (now - started) / duration));
        const e = easeInOutCubic(t);
        renderFold(s, {
          x: from.x + (to.x - from.x) * e,
          y: from.y + (to.y - from.y) * e + lift * Math.sin(Math.PI * e),
        });
        if (t < 1) requestAnimationFrame(frame);
        else resolve();
      };
      requestAnimationFrame(frame);
    });
  }

  async function runAnim(
    s: TurnSession,
    job: () => Promise<void>,
  ): Promise<void> {
    const promise = job();
    s.anim = promise;
    try {
      await promise;
    } finally {
      if (s.anim === promise) s.anim = null;
    }
  }

  async function settle(s: TurnSession): Promise<void> {
    while (s.anim) await s.anim;
  }

  /** Tampilkan lembar yang bisa dibalik dan ganti halaman di bawahnya. */
  function activateTurn(s: TurnSession): Promise<void> {
    s.activation ??= (async () => {
      if (s.openingCover) {
        coverOpening = true;
        await tick();
      }

      const under = s.underPage !== null ? s.underCanvas : null;

      if (mobile) {
        paint(rightCanvas, under);
      } else if (s.openingCover) {
        // Sampul membuka spread: sisi yang baru terbuka tetap putih
        // sampai lembar mendarat di atasnya.
        if (s.direction === "next") {
          clearCanvas(leftCanvas);
          paint(rightCanvas, under);
        } else {
          paint(leftCanvas, under);
          clearCanvas(rightCanvas);
        }
      } else if (s.direction === "next") {
        paint(rightCanvas, under);
      } else {
        paint(leftCanvas, under);
      }

      measureSlot(s);
      if (turnSlot) turnSlot.style.display = "block";
      renderFold(s, cornerPoint(s.corner, s.slotW, s.slotH));
      s.activated = true;
    })();
    return s.activation;
  }

  function hideTurn(): void {
    if (turnSlot) turnSlot.style.display = "none";
  }

  /** Batalkan lipatan: kembalikan halaman asli ke canvas dan buang sesi. */
  function restoreTurn(s: TurnSession): void {
    if (s.activated) copyCanvas(turnFrontCanvas, frontCanvasFor(s));
    coverOpening = false;
    hideTurn();
    if (session === s) session = null;
  }

  /** Buang sesi tanpa menggambar ulang (dipakai sebelum render ulang). */
  function dropSession(): void {
    hideTurn();
    session = null;
    drag = null;
    coverOpening = false;
  }

  function applyFinalCanvases(s: TurnSession): void {
    if (mobile) return;

    const back = s.backPage !== null ? turnBackCanvas : null;

    if (s.targetSingle) {
      paint(rightCanvas, back);
      clearCanvas(leftCanvas);
    } else if (s.direction === "next") {
      paint(leftCanvas, back);
    } else {
      paint(rightCanvas, back);
    }
  }

  async function finishTurn(s: TurnSession): Promise<void> {
    applyFinalCanvases(s);

    skipNextPageRender = true;
    onPageChange(s.target);
    await tick();

    hideTurn();
    session = null;
    coverOpening = false;
    void preloadAround(s.target, calculateScale());
  }

  /** Animasikan lembar hingga terbalik sepenuhnya. */
  async function runFlip(s: TurnSession): Promise<void> {
    if (flipping) return;
    flipping = true;
    error = "";

    try {
      await settle(s);
      await activateTurn(s);
      measureSlot(s);

      const W = s.slotW;
      const H = s.slotH;
      const from = s.p ?? cornerPoint(s.corner, W, H);
      const to = endPoint(s.corner, W, H);
      const remaining = Math.min(1, Math.abs(to.x - from.x) / (2 * W));
      const duration = (s.openingCover ? 1500 : 950) * (0.4 + 0.6 * remaining);
      const lift = (s.corner[0] === "b" ? -1 : 1) * H * 0.2 * remaining;

      await runAnim(s, () => animateFold(s, from, to, duration, lift));
      await finishTurn(s);
    } catch (err) {
      dropSession();
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        error = err instanceof Error ? err.message : "Gagal membalik halaman.";
      }
      void renderCurrent();
    } finally {
      flipping = false;
    }
  }

  /** Kembalikan lembar ke posisi semula. */
  async function runCancel(s: TurnSession): Promise<void> {
    if (flipping) return;
    flipping = true;
    try {
      await settle(s);
      measureSlot(s);
      const c = cornerPoint(s.corner, s.slotW, s.slotH);
      const from = s.p ?? c;
      const away = Math.min(1, Math.abs(from.x - c.x) / s.slotW);
      await runAnim(s, () => animateFold(s, from, c, 240 + 260 * away, 0));
      restoreTurn(s);
    } finally {
      flipping = false;
    }
  }

  async function commitFlip(
    direction: FlipDirection,
    cornerV: "t" | "b" = "b",
  ): Promise<void> {
    if (flipping || !pdfService.isLoaded) return;
    try {
      const s = await ensureSession(direction, cornerV);
      if (!s) return;
      await runFlip(s);
    } catch (err) {
      dropSession();
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        error = err instanceof Error ? err.message : "Gagal membalik halaman.";
      }
    }
  }

  /* ---------- Hover: sudut halaman terangkat sedikit (seperti Turn.js) ---------- */

  function cornerHit(
    event: PointerEvent,
  ): { direction: FlipDirection; cornerV: "t" | "b" } | null {
    if (mobile || coverOpening || isCoverPage(page)) return null;
    const spread = host?.querySelector<HTMLElement>(".book-spread");
    if (!spread) return null;

    const r = spread.getBoundingClientRect();
    const x = event.clientX - r.left;
    const y = event.clientY - r.top;
    if (x < 0 || y < 0 || x > r.width || y > r.height) return null;

    const zone = Math.min(72, r.width * 0.07);
    const cornerV = y < zone ? "t" : y > r.height - zone ? "b" : null;
    if (!cornerV) return null;

    if (x > r.width - zone) return { direction: "next", cornerV };
    if (x < zone) return { direction: "previous", cornerV };
    return null;
  }

  async function startPeel(
    direction: FlipDirection,
    cornerV: "t" | "b",
    key: string,
  ): Promise<void> {
    const s = await ensureSession(direction, cornerV);
    if (!s || s.peeled || s.anim || flipping || drag || hoverKey !== key)
      return;

    await activateTurn(s);
    if (session !== s || hoverKey !== key) return;

    s.peeled = true;
    const W = s.slotW;
    const H = s.slotH;
    const c = cornerPoint(s.corner, W, H);
    const to = {
      x: c.x + (s.corner[1] === "r" ? -1 : 1) * Math.min(46, W * 0.1),
      y: c.y + (s.corner[0] === "b" ? -1 : 1) * Math.min(36, H * 0.05),
    };
    await runAnim(s, () => animateFold(s, c, to, 220, 0));
  }

  async function endPeel(): Promise<void> {
    const s = session;
    if (!s || !s.peeled || flipping || drag) return;
    s.peeled = false;
    await settle(s);
    if (session !== s || flipping || drag) return;

    const c = cornerPoint(s.corner, s.slotW, s.slotH);
    await runAnim(s, () => animateFold(s, s.p ?? c, c, 200, 0));
    if (session === s && !s.peeled && !drag && !flipping) restoreTurn(s);
  }

  /* ---------- Drag ---------- */

  function pressTarget(
    event: PointerEvent | MouseEvent,
  ): { direction: FlipDirection; cornerV: "t" | "b" } | null {
    const spread = host?.querySelector<HTMLElement>(".book-spread");
    if (!spread) return null;
    const rect = spread.getBoundingClientRect();

    let direction: FlipDirection;
    if (mobile || isCoverPage(page)) {
      const sheet = spread.querySelector<HTMLElement>(".page-sheet");
      const sr = sheet?.getBoundingClientRect();
      if (!sr || event.clientX < sr.left || event.clientX > sr.right)
        return null;
      direction = event.clientX >= sr.left + sr.width / 2 ? "next" : "previous";
    } else {
      direction =
        event.clientX >= rect.left + rect.width / 2 ? "next" : "previous";
    }

    const cornerV = event.clientY < rect.top + rect.height / 2 ? "t" : "b";
    return { direction, cornerV };
  }

  function updateDrag(d: DragState): void {
    const s = d.session;
    if (!s || !d.base) return;
    renderFold(s, {
      x: d.base.x + (d.lastX - d.startX),
      y: d.base.y + (d.lastY - d.startY),
    });
  }

  function onBookPointerDown(event: PointerEvent): void {
    if (event.button !== 0 || flipping || loading || !pdfService.isLoaded)
      return;

    const hit = pressTarget(event);
    if (!hit) return;

    drag = {
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      prevX: event.clientX,
      prevT: performance.now(),
      vx: 0,
      direction: hit.direction,
      cornerV: hit.cornerV,
      started: false,
      starting: null,
      session: null,
      base: null,
    };

    try {
      host?.setPointerCapture(event.pointerId);
    } catch {
      /* pointer capture is optional */
    }

    // Siapkan sisi belakang lembar sejak pointer menekan, sebelum drag dimulai.
    void ensureSession(hit.direction, hit.cornerV).catch(() => {});
  }

  function onBookPointerMove(event: PointerEvent): void {
    const d = drag;

    if (!d) {
      if (event.pointerType !== "mouse" || flipping || loading) return;
      const hit = cornerHit(event);
      if (!hit) {
        hoverKey = "";
        void endPeel();
        return;
      }
      const key = `${hit.direction}${hit.cornerV}`;
      if (key === hoverKey) return;
      hoverKey = key;
      if (session?.peeled) {
        void endPeel().then(() => {
          if (hoverKey === key) void startPeel(hit.direction, hit.cornerV, key);
        });
      } else {
        void startPeel(hit.direction, hit.cornerV, key).catch(() => {});
      }
      return;
    }

    if (flipping) return;

    const now = performance.now();
    const dt = Math.max(1, now - d.prevT);
    d.vx = 0.6 * d.vx + 0.4 * ((event.clientX - d.prevX) / dt);
    d.prevX = event.clientX;
    d.prevT = now;
    d.lastX = event.clientX;
    d.lastY = event.clientY;

    if (!d.started) {
      const dx = event.clientX - d.startX;
      const dy = event.clientY - d.startY;
      const towardSpine = d.direction === "next" ? dx < -6 : dx > 6;
      if (!towardSpine || Math.abs(dx) < Math.abs(dy) * 0.8) return;

      d.started = true;
      d.starting = (async () => {
        const s = await ensureSession(d.direction, d.cornerV);
        if (!s || drag !== d) return;
        await settle(s);
        await activateTurn(s);
        if (drag !== d) return;
        measureSlot(s);
        d.base =
          s.peeled && s.p
            ? { ...s.p }
            : cornerPoint(s.corner, s.slotW, s.slotH);
        s.peeled = false;
        d.session = s;
        updateDrag(d);
      })().catch(() => {
        drag = null;
      });
      return;
    }

    updateDrag(d);
  }

  async function finishDrag(d: DragState): Promise<void> {
    await d.starting;
    const s = d.session;
    if (drag === d) drag = null;
    if (!s || session !== s) return;

    const W = Math.max(1, s.slotW);
    const c = cornerPoint(s.corner, W, s.slotH);
    const moved = Math.abs((s.p?.x ?? c.x) - c.x) / W;
    const flick = d.direction === "next" ? d.vx < -0.6 : d.vx > 0.6;

    if (moved > 0.4 || (flick && moved > 0.08)) await runFlip(s);
    else await runCancel(s);
  }

  function onBookPointerUp(event: PointerEvent): void {
    const d = drag;
    try {
      host?.releasePointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
    if (!d) return;

    if (!d.started) {
      drag = null;
      return;
    }

    suppressNextClick = true;
    void finishDrag(d);
  }

  function onBookPointerCancel(): void {
    const d = drag;
    if (!d) return;
    if (!d.started) {
      drag = null;
      return;
    }
    d.vx = 0;
    suppressNextClick = true;
    void (async () => {
      await d.starting;
      const s = d.session;
      if (drag === d) drag = null;
      if (s && session === s) await runCancel(s);
    })();
  }

  function onBookPointerLeave(): void {
    hoverKey = "";
    void endPeel();
  }

  function onBookClick(event: MouseEvent): void {
    if (suppressNextClick) {
      suppressNextClick = false;
      return;
    }
    if (flipping || loading || !pdfService.isLoaded) {
      return;
    }

    const spread =
      event.currentTarget instanceof HTMLElement
        ? event.currentTarget.querySelector(".book-spread")
        : null;

    if (!(spread instanceof HTMLElement)) {
      return;
    }

    const rect = spread.getBoundingClientRect();
    const cornerV: "t" | "b" =
      event.clientY < rect.top + rect.height / 2 ? "t" : "b";

    // Pada sampul (halaman tunggal), spread masih selebar area buku.
    // Gunakan posisi halaman yang benar agar klik sebelumnya tidak jatuh
    // pada area kosong di sisi kiri/kanan spread.
    if (mobile || isCoverPage(page)) {
      const sheet = spread.querySelector(".page-sheet");
      if (!(sheet instanceof HTMLElement)) return;

      const pageRect = sheet.getBoundingClientRect();
      const x = event.clientX - pageRect.left;

      if (x < 0 || x > pageRect.width) return;

      if (x <= pageRect.width * 0.46) {
        void commitFlip("previous", cornerV);
      } else if (x >= pageRect.width * 0.54) {
        void commitFlip("next", cornerV);
      }
      return;
    }

    const x = event.clientX - rect.left;

    // Area kecil di sekitar punggung buku tidak memicu navigasi.
    const spineTolerance = Math.min(12, rect.width * 0.015);
    const center = rect.width / 2;

    if (x < center - spineTolerance) {
      void commitFlip("previous", cornerV);
    } else if (x > center + spineTolerance) {
      void commitFlip("next", cornerV);
    }
  }

  function handleKey(event: KeyboardEvent): void {
    if (event.key === "ArrowRight") {
      void commitFlip("next");
    }

    if (event.key === "ArrowLeft") {
      void commitFlip("previous");
    }
  }

  /*
   * Window events.
   */
  $effect(() => {
    updateMobile();

    window.addEventListener("resize", updateMobile);

    window.addEventListener("keydown", handleKey);

    return () => {
      window.removeEventListener("resize", updateMobile);

      window.removeEventListener("keydown", handleKey);
    };
  });

  /*
   * Load PDF.
   */
  $effect(() => {
    void pdfUrl;

    let cancelled = false;

    (async () => {
      try {
        await pdfService.load(pdfUrl);

        if (cancelled) {
          return;
        }

        onPageCount(pdfService.numPages);

        onPdfReady(pdfService);

        await renderCurrent();
      } catch (err) {
        if (!cancelled) {
          loading = false;

          error = err instanceof Error ? err.message : "Gagal membuka PDF.";
        }
      }
    })();

    return () => {
      cancelled = true;

      cache.clear();
      pdfService.destroy();
    };
  });

  /*
   * Render ketika page / zoom / mobile berubah.
   */
  $effect(() => {
    void page;
    void zoom;
    void mobile;

    if (skipNextPageRender) {
      skipNextPageRender = false;
      return;
    }

    if (pdfService.isLoaded && !flipping) {
      dropSession();
      void renderCurrent();
    }
  });

  onDestroy(() => {
    cache.clear();
    pdfService.destroy();
  });
</script>

<div
  bind:this={host}
  role="application"
  class="relative flex h-full min-h-0 w-full select-none items-center justify-center overflow-hidden [touch-action:pan-y]"
  onpointerdown={onBookPointerDown}
  onpointerup={onBookPointerUp}
  onpointermove={onBookPointerMove}
  onpointercancel={onBookPointerCancel}
  onpointerleave={onBookPointerLeave}
  onclick={onBookClick}
>
  <div
    class="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,.06),transparent_52%)]"
  ></div>

  {#if error}
    <div
      class="relative z-30 rounded-xl border border-red-400/20 bg-red-400/5 px-5 py-4 text-sm text-red-300"
    >
      {error}
    </div>
  {:else}
    <div
      class:mobile
      class:desktop={!mobile}
      class="book-stage relative flex items-center justify-center"
    >
      <div class="book-shadow"></div>

      <div class="book-card">
        <div class="book-card-glow"></div>
        <div class="book-spread-shell">
          <div
            class:single={mobile || (isCoverPage(page) && !coverOpening)}
            class:opening-cover={coverOpening}
            class="book-spread"
          >
            {#if !mobile && (coverOpening || (page !== 1 && !isCoverPage(page)))}
              <div class="page-sheet left-page">
                <canvas bind:this={leftCanvas}></canvas>

                <div class="page-edge left-edge"></div>
              </div>
            {/if}

            <div
              class:single-page={mobile || (isCoverPage(page) && !coverOpening)}
              class:right-page={!mobile && (!isCoverPage(page) || coverOpening)}
              class="page-sheet"
            >
              <canvas bind:this={rightCanvas}></canvas>

              <div class="page-edge"></div>
            </div>

            <!--
              Slot lipatan: JS memposisikannya tepat di atas halaman yang
              sedang dibalik. Tersembunyi saat tidak ada gerakan.
            -->
            <div class="turn-slot" bind:this={turnSlot} aria-hidden="true">
              <div class="turn-under" bind:this={underBox}>
                <div class="turn-under-shade" bind:this={underShade}></div>
              </div>

              <div class="turn-clip" bind:this={clipLayer}>
                <!-- Lembar depan: halaman yang terlihat sebelum dibalik -->
                <div class="turn-front" bind:this={frontLayer}>
                  <canvas bind:this={turnFrontCanvas}></canvas>
                </div>

                <!-- Sisi belakang kertas, dicerminkan di garis lipat -->
                <div class="turn-flap" bind:this={flapLayer}>
                  <div class="turn-flap-back">
                    <canvas bind:this={turnBackCanvas}></canvas>
                  </div>
                  <div class="turn-flap-shade" bind:this={flapShade}></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {#if loading}
        <div
          class="absolute inset-0 z-40 flex items-center justify-center bg-black/10"
        >
          <div
            class="rounded-full border border-white/10 bg-black/55 px-4 py-2 text-xs text-slate-300 backdrop-blur"
          >
            Memuat halaman...
          </div>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  /* =========================================================
     VIEWER: memenuhi area parent dan menjaga buku tetap center
  ========================================================= */

  :global(*) {
    box-sizing: border-box;
  }

  :global(html),
  :global(body) {
    min-width: 0;
  }

  .book-stage {
    position: relative;
    isolation: isolate;
    container-type: size;
    /* Perspektif 3D agar lembar terasa terangkat saat dibuka. */
    perspective: 950px;
    perspective-origin: 50% 45%;
    width: min(100%, 1760px);
    height: min(100%, 1180px);
    min-width: 0;
    min-height: 0;
    margin-inline: auto;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  /* =========================================================
     CARD: ruang halaman tidak terbuang oleh padding besar
  ========================================================= */

  .book-card {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    padding: clamp(4px, 0.8vw, 14px);
    overflow: hidden;
    border: 1px solid rgba(148, 163, 184, 0.24);
    border-radius: clamp(10px, 1.2vw, 22px);
    background: linear-gradient(
      145deg,
      rgba(30, 41, 59, 0.96),
      rgba(9, 14, 25, 0.98) 58%,
      rgba(17, 24, 39, 0.98)
    );
    box-shadow:
      0 28px 80px rgba(0, 0, 0, 0.48),
      0 8px 24px rgba(0, 0, 0, 0.3),
      inset 0 1px 0 rgba(255, 255, 255, 0.09),
      inset 0 0 0 5px rgba(255, 255, 255, 0.018);
  }

  .book-card::before {
    content: "";
    position: absolute;
    inset: 6px;
    border: 1px solid rgba(255, 255, 255, 0.045);
    border-radius: 12px;
    pointer-events: none;
  }

  .book-card-glow {
    position: absolute;
    inset: 0;
    border-radius: inherit;
    /* background: radial-gradient(
      ellipse at 50% 42%,
      rgba(148, 163, 184, 0.12),
      transparent 62%
    ); */
    background: #ffffff;
    pointer-events: none;
  }

  /* =========================================================
     SPREAD: dua halaman desktop selalu di tengah card
  ========================================================= */

  .book-spread-shell {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    padding: 0;
    overflow: hidden;
    box-sizing: border-box;
    transform-style: preserve-3d;
  }

  .book-spread {
    position: relative;
    display: flex;
    align-items: stretch;
    justify-content: center;
    flex: 0 1 auto;
    width: min(100%, calc((100cqh - 36px) * 1.4142));
    aspect-ratio: 1.4142;
    max-width: 100%;
    max-height: 100%;
    min-width: 0;
    min-height: 0;
    margin: auto;
    cursor: default;
    transform-style: preserve-3d;
    filter: drop-shadow(0 16px 18px rgba(0, 0, 0, 0.3));
    /* Animasi ini hanya menghaluskan perubahan tata letak sampul tunggal
       menjadi spread dua halaman; transform animasi flip tidak diubah. */
    transition:
      width 760ms cubic-bezier(0.22, 1, 0.36, 1),
      height 760ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  /* =========================================================
     PAGE: setiap halaman mengikuti setengah spread
  ========================================================= */

  .page-sheet {
    position: relative;
    flex: 0 1 50%;
    width: 50%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    aspect-ratio: 0.7071;
    overflow: hidden;
    background: #fff;
    cursor: pointer;
    box-shadow:
      0 0 0 1px rgba(15, 23, 42, 0.16),
      inset 0 0 0 1px rgba(15, 23, 42, 0.08),
      inset 0 0 20px rgba(15, 23, 42, 0.035);
    /* Perubahan ukuran/posisi lembar saat layout cover -> spread. */
    transition:
      width 760ms cubic-bezier(0.22, 1, 0.36, 1),
      flex-basis 760ms cubic-bezier(0.22, 1, 0.36, 1),
      border-radius 760ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  .desktop .page-sheet {
    flex: 0 1 50%;
    width: 50%;
    max-width: 50%;
    height: 100%;
    max-height: 100%;
  }

  /* Paksa canvas mengikuti kotak halaman.
     Ukuran bitmap internal tetap dikelola oleh PdfService. */

  .page-sheet canvas {
    position: relative;
    z-index: 1;
    display: block;
    width: 100% !important;
    height: 100% !important;
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    background: #fff;
  }

  .left-page {
    z-index: 1;
    transform-origin: right center;
    border-radius: 3px 0 0 3px;
    box-shadow:
      inset -12px 0 18px rgba(15, 23, 42, 0.11),
      inset 0 0 0 1px rgba(15, 23, 42, 0.1),
      -2px 3px 7px rgba(0, 0, 0, 0.16);
  }

  .right-page {
    z-index: 1;
    transform-origin: left center;
    border-radius: 0 3px 3px 0;
    box-shadow:
      inset 12px 0 18px rgba(15, 23, 42, 0.12),
      inset 0 0 0 1px rgba(15, 23, 42, 0.1),
      2px 3px 7px rgba(0, 0, 0, 0.16);
  }

  /* Halaman kiri muncul dari punggung buku saat spread mulai terbuka.
     Ini hanya animasi layout, bukan animasi membalik halaman. */
  .book-spread.opening-cover .left-page {
    transform-origin: right center;
    animation: reveal-left-page 760ms cubic-bezier(0.22, 1, 0.36, 1) both;
  }

  @keyframes reveal-left-page {
    from {
      clip-path: inset(0 0 0 100%);
      opacity: 0.82;
    }
    to {
      clip-path: inset(0 0 0 0);
      opacity: 1;
    }
  }

  /* =========================================================
     SINGLE PAGE: mobile dan tampilan satu halaman
  ========================================================= */

  .book-spread.single {
    display: flex;
    align-items: center;
    justify-content: center;
    /* Keep the spread frame constrained to the same book-card bounds
       before, during, and after the cover-to-spread transition. */
    width: min(100%, calc((100cqh - 36px) * 1.4142));
    height: auto;
    max-width: 100%;
    max-height: 100%;
    aspect-ratio: 1.4142;
    box-sizing: border-box;
  }

  .single-page {
    flex: 0 1 auto;
    width: min(100%, calc((100cqh - 36px) * 0.7071));
    height: auto;
    max-width: 100%;
    max-height: 100%;
    aspect-ratio: 0.7071;
    border-radius: 3px;
    transition:
      width 760ms cubic-bezier(0.22, 1, 0.36, 1),
      flex-basis 760ms cubic-bezier(0.22, 1, 0.36, 1),
      border-radius 760ms cubic-bezier(0.22, 1, 0.36, 1);
    box-shadow:
      0 0 0 1px rgba(15, 23, 42, 0.15),
      5px 8px 18px rgba(0, 0, 0, 0.22),
      inset 0 0 0 1px rgba(15, 23, 42, 0.07);
  }

  /* =========================================================
     DETAIL VISUAL BUKU
  ========================================================= */

  .book-spread:not(.single)::after {
    content: "";
    position: absolute;
    z-index: 4;
    top: 0;
    bottom: 0;
    left: 50%;
    width: clamp(8px, 1vw, 18px);
    transform: translateX(-50%);
    pointer-events: none;
    background: linear-gradient(
      90deg,
      rgba(15, 23, 42, 0.3),
      rgba(15, 23, 42, 0.06) 28%,
      rgba(255, 255, 255, 0.24) 50%,
      rgba(15, 23, 42, 0.16) 72%,
      rgba(15, 23, 42, 0.3)
    );
  }

  .page-edge {
    position: absolute;
    inset: 0;
    pointer-events: none;
    box-shadow: inset 0 0 24px rgba(15, 23, 42, 0.075);
  }

  .left-edge {
    box-shadow: inset -16px 0 24px rgba(15, 23, 42, 0.14);
  }

  .book-shadow {
    position: absolute;
    width: 88%;
    height: 13%;
    bottom: -5%;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.72);
    filter: blur(30px);
    transform: translateZ(-35px);
    pointer-events: none;
  }

  /* =========================================================
     PAGE CURL
     Semua transform/ukuran layer diatur oleh TurnEngine lewat JS.
     Setiap layer memakai transform-origin 0 0.
  ========================================================= */

  .turn-slot {
    position: absolute;
    left: 0;
    top: 0;
    z-index: 20;
    display: none;
    overflow: visible;
    pointer-events: none;
  }

  .turn-under {
    position: absolute;
    left: 0;
    top: 0;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }

  /* Bayangan di halaman yang terbuka, tepat di sebelah garis lipat. */
  .turn-under-shade {
    position: absolute;
    left: 0;
    top: 0;
    transform-origin: 0 0;
    background: linear-gradient(
      to right,
      rgba(15, 23, 42, 0),
      rgba(15, 23, 42, 0.34)
    );
  }

  /* Kotak pemotong: overflow hidden inilah yang membuat potongan diagonal. */
  .turn-clip {
    position: absolute;
    left: 0;
    top: 0;
    overflow: hidden;
    transform-origin: 0 0;
    will-change: transform;
  }

  .turn-front,
  .turn-flap {
    position: absolute;
    left: 0;
    top: 0;
    transform-origin: 0 0;
    background: #fff;
  }

  .turn-flap {
    overflow: hidden;
    box-shadow: 0 0 16px rgba(15, 23, 42, 0.42);
  }

  /* Sisi belakang dicerminkan horizontal; pencerminan di garis lipat
     oleh transform .turn-flap membuatnya terbaca normal. */
  .turn-flap-back {
    position: absolute;
    inset: 0;
    background: #fff;
    transform: scaleX(-1);
  }

  /* Gelap di dekat garis lipat, sedikit pantulan di tengah lipatan. */
  .turn-flap-shade {
    position: absolute;
    left: 0;
    top: 0;
    transform-origin: 0 0;
    pointer-events: none;
    background: linear-gradient(
      to right,
      rgba(255, 255, 255, 0) 0%,
      rgba(255, 255, 255, 0.2) 50%,
      rgba(15, 23, 42, 0.3) 100%
    );
  }

  .turn-front canvas,
  .turn-flap-back canvas {
    display: block;
    width: 100% !important;
    height: 100% !important;
    background: #fff;
  }

  /* =========================================================
     TABLET DAN MOBILE
  ========================================================= */

  @media (max-width: 767px) {
    .book-stage {
      width: 100%;
      height: min(82dvh, 900px);
    }

    .book-card {
      padding: 4px;
      border-radius: 12px;
    }

    .book-card::before {
      inset: 4px;
      border-radius: 9px;
    }

    .book-spread-shell {
      padding: 0;
    }

    .book-spread.single {
      width: 100%;
      height: auto;
      max-width: 100%;
      max-height: 100%;
      aspect-ratio: 1.4142;
    }

    .single-page {
      width: min(100%, calc((100cqh - 24px) * 0.7071));
      height: auto;
      max-height: calc(100cqh - 24px);
    }

    .book-spread:not(.single)::after {
      width: 10px;
    }
  }

  /* =========================================================
     LAYAR PENDEK / LANDSCAPE
  ========================================================= */

  @media (max-height: 560px) {
    .book-stage {
      height: 92dvh;
    }

    .book-card {
      padding: 4px;
    }

    .book-spread {
      width: min(100%, calc((92dvh - 20px) * 1.4142));
    }

    .single-page {
      width: min(100%, calc((92dvh - 20px) * 0.7071));
      max-height: calc(92dvh - 20px);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .book-spread,
    .page-sheet,
    .single-page {
      transition: none !important;
      animation: none !important;
    }
  }

  /* =========================================================
     KERTAS PUTIH: permukaan halaman harus terlihat jelas,
     sedangkan efek lipatan hanya berada di tepi kertas.
  ========================================================= */
  .page-sheet {
    background: #fff !important;
    /* border: 1px solid #d9dee7; */

    box-shadow:
      0 -3px 8px 2px rgba(0, 0, 0, 0.12),
      -5px 0 12px 3px rgba(0, 0, 0, 0.1),
      5px 0 12px 3px rgba(0, 0, 0, 0.1),
      0 2px 2px 0 rgba(0, 0, 0, 0.04),
      inset 8px 0 10px -7px rgba(190, 190, 190, 0.55);
  }

  .page-sheet canvas {
    position: relative;
    z-index: 1;
    background: #fff !important;
  }

  .page-edge {
    z-index: 2;
    box-shadow: inset 0 0 12px rgba(15, 23, 42, 0.025);
  }

  .left-edge {
    box-shadow: inset -10px 0 14px rgba(15, 23, 42, 0.07);
  }
</style>
