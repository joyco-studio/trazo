# Iteración 6 — git mode: bug de auto-ids encontrado vía comparación + gitGraph vs mermaid

> 2026-07-02 · workstream A (Mati) — git graphs explícitamente pedidos

## Bug real encontrado (y arreglado): colisión de auto-ids en el git DSL

Al armar el caso de stress para la comparación (3 branches + 3 merges + un
commit con id explícito `m2`), el playground mostró **8 commits cuando el DSL
tenía 9** y el orden de filas revuelto (INITIAL COMMIT en el medio).

- **Root cause** (`parse-git.ts`): los merges generan ids `m${++autoCounter}`
  sin chequear colisión con ids escritos por el usuario. El commit del usuario
  `m2` ("main work") se fusionó silenciosamente con el segundo merge → commit
  perdido, parents corruptos, orden roto. Los `commit` anónimos (`c<N>`)
  tenían la variante "ruidosa": un falso error "duplicate commit id".
- **Fix**: `freshId(prefix)` — el contador avanza saltando ids tomados.
  Determinista (solo avanza). Ids explícitos duplicados siguen fallando con
  error (comportamiento correcto pre-existente).
- 2 tests nuevos en `parse-git.test.ts` (merge que saltea `m2` del usuario;
  commit anónimo que saltea `c1`). **223 tests verdes.** Verificado también en
  browser: 9 commits · 11 edges, MAIN WORK presente, orden correcto.
- El playground usa `parseGit` de la lib (alias `parseDsl`) → un solo fix cubre
  ambos. Docs (`dsls.md`) y changeset actualizados.

Moraleja del método: la comparación con mermaid no encontró el bug — lo
encontró **escribir el caso de prueba adversarial** para la comparación. El
harness estructural (A6) no lo agarraba porque entra por el parser, no por
`layoutGit`.

## Comparación gitGraph: trazo vs mermaid 11.15

| Aspecto | trazo | mermaid gitGraph |
| --- | --- | --- |
| Layout | vertical (u horizontal), newest arriba | horizontal, swimlanes por branch |
| Labels de commit | badge horizontal legible: hash + mensaje + autor | solo id, **rotado 45°** — un id largo queda diagonal e ilegible |
| Mensajes largos | badge single-line ancho (canvas lo contiene) | rotado en diagonal, pisa el lane de abajo |
| Branch labels | color de lane (cíclico ×6) | chips con nombre de branch por swimlane |
| Merges | diagonales 45° estilo JOYCO | curvas |

Ninguno colapsa; trazo es claramente más legible en mensajes. **Backlog
sugerido**: truncar el mensaje del badge git con ellipsis a un ancho máximo
(lo que hacen las UIs de git reales) en vez de crecer indefinidamente — anotado
como follow-up, no crítico para los logs.

## Estado del loop

Los objetivos de ambos stakeholders están completos. Backlog restante (todo
baja prioridad): A8 (edge-label dummy nodes), truncado de badges git, URL-sync
del theme (nuqs), overshoot cosmético de bezier. La cadencia del loop se
estira: sin trabajo crítico pendiente, próxima revisión en ~25 min.
