# Iteración 3 — theme editor del playground (B4)

> 2026-07-02 · workstream B (Joyboy)

## Qué se hizo

1. **Presets** (`apps/playground/src/lib/themes.ts`):
   - `JOYCO_PRESET` — default del playground, reproduce el mock oscuro: canvas
     `#171717` + hatch, primary `#0011ff`, neutral negro/blanco, warning
     `#ffd400`, error `#ff4d00`, success `#84ff00` + knobs del `joycoTheme` de
     la lib (padding sm, roundness none, angular, texture, border large).
   - `SOFT_PRESET` — el opuesto (mock beige): padding lg, roundness lg, lanes
     rounded, background solid, border none, paleta pastel completa.
   - `themeToCss()` — export como bloque `--trazo-*`.
2. **`ThemePanel`** (`theme-panel.tsx`) — sheet lateral: preset picker, knobs
   (padding/roundness/lanes mode/lane style/background/border como button
   groups, lane gap como slider 0–10), inputs del frame (label + número), grid
   de tokens (9 roles × fill+foreground, superficies, 6 lanes git) con
   `<input type="color">`, y export JSON/CSS con estado copied.
3. **Inspector** re-cableado: `theme` reemplaza a `edgeStyle` (el switch 45° se
   fue — lanes mode lo cubre), `build()` usa `themeFlowOptions`/
   `themeGitOptions`, `<Graph theme>`, y el **frame** se renderiza como chips
   HTML absolutos sobre el preview (Decisión 4 de la spec).
4. **`page.tsx` (server)**: el seed se layoutea con `DEFAULT_THEME` — el mismo
   theme con el que hidrata el Inspector, para no romper la invariante
   SSR-byte-identical.
5. **Lib**: `themed()` movido a `theme.ts` (una sola definición del chain de 3
   capas) y `resolveThemePaint` ahora auto-apunta `--trazo-bg` al canvas cuando
   el theme pinta background (regla de la memory "node border = backdrop real";
   respeta un `bg` explícito del usuario).

## Decisiones registradas

- **Preset joyco de la lib ≠ preset joyco del playground**: la lib queda
  colorless (adopta shadcn tokens de la app), el playground pinta la paleta
  exacta del mock — es la cara visible y el export lleva color codes reales,
  como pidió Joyboy ("pueden repetirse color codes, pero separados").
- **Edición copy-on-write**: tocar cualquier knob/token forkea a `custom`; los
  presets son inmutables. El frame NO forkea (es contenido, no estilo).
- **Sin URL-sync (nuqs) por ahora** — el CLAUDE.md del playground lo pide para
  estado de UI; anotado como follow-up para no inflar esta iteración.
- Los chips del frame usan `tokens.accent`/`accent-foreground` con fallback a
  los tokens del app — mismos colores que tendría embebido en el SVG.

## Verificación

- `tsc --noEmit` limpio en playground y lib · ESLint limpio (import sort
  auto-fixeado) · `next build` de producción OK (SSG de `/` y `/docs`).
- 219 tests de la lib siguen verdes; `pnpm build` del paquete regenerado.
- **Pendiente: verificación visual** (screenshot vs mock) — es B5, próxima
  iteración junto con A4 (comparación mermaid), ambas con claude-in-chrome.

## Próximo

1. **B5**: levantar el playground, screenshot del joyco theme vs mock 1, ajustar
   diferencias (tipografía mono del mock, tamaños de chips, hatch density).
2. **A4/A5**: comparación con mermaid playground (ciclos, self-loops, textos
   largos, denso) + estudio del edge-label collision handling de dagre.
