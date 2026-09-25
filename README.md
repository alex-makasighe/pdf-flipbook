# PDF Flipbook

SvelteKit fullstack PDF flipbook dengan:

- Svelte 5 + TypeScript
- Bun / Vite
- Tailwind CSS v4
- PDF.js
- Local filesystem storage
- Upload PDF
- PDF metadata sidecar JSON tanpa database
- HTTP Range request
- Desktop two-page spread
- Mobile single-page mode
- Drag / swipe page turn
- CSS 3D page-turn effect
- Thumbnail navigation
- Zoom
- Keyboard navigation
- Fullscreen

## Arsitektur

```text
src/
├── modules/
│   ├── documents/
│   │   ├── presentation/
│   │   ├── services/
│   │   ├── repositories/
│   │   └── types/
│   └── viewer/
│       ├── presentation/
│       ├── services/
│       └── types/
├── shared/
└── routes/
    ├── api/
    └── viewer/
```

Dependency direction:

```text
Presentation
     ↓
 Services
     ↓
 Repository
```

`src/routes` adalah adapter HTTP/page SvelteKit. Business logic tetap berada di module.

## Menjalankan

```bash
bun install
bun run dev
```

Buka:

```text
http://localhost:5173
```

## Build

```bash
bun run check
bun run build
bun run preview
```

## Storage

PDF:

```text
storage/pdf/
```

Metadata:

```text
storage/meta/
```

Database sengaja belum digunakan.

## Catatan flipbook

Implementasi ini membuat pengalaman yang mendekati pola viewer seperti FlipHTML5: spread desktop, single page mobile, thumbnail, drag/swipe, perspective, shadow, dan page-turn 3D.

Ini bukan clone engine FlipHTML5 dan tidak menjamin pixel-perfect parity. Untuk produksi dengan PDF sangat besar, tahap berikutnya sebaiknya menambahkan cache/render management yang lebih agresif, persistence metadata yang lebih kuat, serta optimasi thumbnail.
