# Ronda de QA visual — 4 fixes de rendering + OKLCH

> 2026-07-14 · respuesta al review del dev: "esto ya debería haberse
> atajado/revisado en el loop"

## Falla de proceso (asumida)

Correcto: la verificación visual de las iteraciones anteriores cubrió el happy
path (seed + un caso por feature), no la galería completa, y nunca con ambos
presets. **Regla nueva del loop: después de tocar layout o renderer, correr
TODOS los diagramas de `11-test-diagrams.md` en el server local, con joyco Y
soft, antes de dar por bueno el cambio.** Esta ronda se hizo así (screenshots
de cada caso en ambos presets + zooms a los puntos de contacto flecha/borde).

## Los 3 reportes del dev → 4 causas raíz

| Reporte | Causa raíz | Fix |
| --- | --- | --- |
| "Las arrows se pisan con los bordes" (joyco) | El tip del marker caía exactamente en la cara geométrica = el CENTRO de la banda del border (large = 4px, 2 afuera/2 adentro) | El trim ahora incluye `borderWidth/2`: el tip descansa en el borde exterior del stroke (`graph.tsx`) |
| "Papoi achieved tiene la arrow mal colocada" (soft) | `turnKnees` era direction-blind: con drop largo giraba AL FINAL (jog de último segundo pegado al target) | `turnKnees` recibe el main axis: el shift cross-axis pasa cerca del SOURCE y la aproximación final corre por el eje del flujo (el look del mock/mermaid) |
| Caso #2 roto: "triángulo flotante", corredores pisando nodos | (a) Los back-edges con span >1 rank metían los centros de su dummy chain ENTRE el corredor y la entrada; (b) el corredor solo liberaba los 2 endpoints, no los nodos intermedios (el PROCESS ancho quedaba a 1px) | (a) Back-edges sin dummy chain (el corredor los reemplaza); (b) el corredor se calcula sobre el extent máximo de TODOS los ranks que atraviesa |
| "Se leerían más fácil centrados como mermaid" | El pack inicial era left-aligned, sin refinamiento | **Sweeps de median-alignment** (down hacia up-neighbors, up hacia down-neighbors, ×2) resueltos por capa con **PAVA** (isotonic regression): expresando posiciones como shift + offsets acumulados de separación mínima, "mantener orden sin overlaps" ⇔ "shifts no-decrecientes" — los bloques en conflicto quedan en la media de sus deseos. Determinista. Reemplaza el hack de lone-chain straightening |

Resultado verificado en browser: raíces centradas sobre su fan-out, spines
rectos, hijos alineados bajo sus padres, corredores limpios, flechas con aire.

## OKLCH (pedido previo, cerrado en esta ronda)

- Presets en `oklch(L C H)` (conversión exacta via culori).
- Picker OKLCH del branch `kahdri/color-picker` (sliders L/C/H con gradientes)
  integrado al theme panel, reemplaza los `<input type="color">`.
- **Foregrounds automáticos por contraste**: `resolveThemePaint` deriva
  blanco/negro por lightness perceptual (canal L de OKLCH directo; hex via
  sRGB→OKLab, matemática pura sin deps en el engine — culori queda solo en el
  playground). Umbral L=0.65. Explícito siempre gana; los presets solo pinnean
  las excepciones de diseño (fgs dim de ghost/muted en joyco, blanco del error
  borderline L≈0.67, y todos los tintados de soft). El panel muestra "AUTO" y
  un × para volver al derivado.

## Estado

- 232 tests verdes, tsc/eslint limpios en lib y playground.
- Commiteado por track: fixes de rendering/layout en `feat/robustness`, OKLCH
  y theme editor en `feat/theming` (mergeada sobre robustness).
- Nota: el dev server del dev consume `packages/trazo/dist` — el dist quedó
  rebuildeado; si el preview no refleja los fixes, hard-reload o reiniciar el
  dev server.
