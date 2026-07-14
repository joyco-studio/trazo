# Diagramas de prueba — copiar y pegar en el playground

> Snippets listos para el editor de cada modo. Cada uno dice QUÉ mirar.
> Combinalos con el theme panel (presets joyco/soft, lanes mode, roundness,
> lane gap) para cubrir la matriz visual completa.

## Flowchart

### 1. Papoi (el mock de Joyboy — validación del theme)

Con preset **joyco** debe reproducir el mock oscuro; con **soft**, el beige.

```
flow TD
A["PAPOI"]:neutral --> B["PAPOI"]:primary
B --> C["Papoi achieved"]:ghost
B --> D["Papoi?"]:warning
B --> E["Papoi died"]:error
D --> F["PAPOI WINS"]:success
E --> G["PAPOI"]:error
```

### 2. Tortura de robustez: self-loop + 2 ciclos + label largo

Mirar: el self-loop de `B` como corredor compacto, los 2 back-edges por
corredores laterales sin pisar nodos, el label largo wrappeado a ~3 líneas
(auto-wrap a 260px), y con **lane gap > 0** el aire entre flechas y cajas.
En **lanes mode bezier** las curvas deben ser splines sueltos, sin hairpins.

```
flow TD
A["Start"] --> B["Process with a very long label that keeps going and going"]
B --> C{"Retry?"}
C --> B
C --> A
B --> B
C --> D["Done"]:success
```

### 3. Vitrina de roles y shapes (los 9 tokens + diamond redondeado)

Mirar: cada rol con su color + foreground del theme; con **roundness sm/lg**
las cajas Y el diamond se redondean (stadium mantiene pill, cylinder sus
tapas). `streamed` debe pintar igual que `info` (alias).

```
flow TD
P(["primary"]):primary --> S["secondary"]:secondary
P --> G["ghost"]:ghost
P --> M["muted"]:muted
P --> N["neutral"]:neutral
S --> OK{"success?"}:success
OK --> W["warning"]:warning
OK --> E["error"]:error
OK --> I[("info")]:info
G --> ST["streamed = info"]:streamed
```

### 4. Edge labels + fan-out (leveling de siblings y bounds)

Mirar: los labels de las 3 ramas alineados en una fila, el label largo del
edge contenido dentro del canvas (nunca recortado por el viewBox).

```
flow TD
A{"Deploy?"}:primary --> B["Staging"]:warning
A --> C["Production"]:success
A --> D["Rollback"]:error
A --> E["Cancel"]:ghost
B --> F["Smoke tests with a very long transition description here"]:info
```

### 5. Subgraphs + LR + edges variados

Mirar: cajas de grupo con título, dirección LR, `==>` coloreado por el rol
del origen, `---` sin flecha, `<-->` bidireccional.

```
flow LR
subgraph FE ["Frontend"]
A(["User"]):primary
B["Next.js"]:info
end
subgraph BE ["Backend"]
C["API"]:secondary
D[("Postgres")]:success
end
A ==> B
B <--> C
C --> D
B --- D
```

### 6. Denso (stress de orden y cruces)

Mirar: sin overlaps de nodos, cruces de edges razonables, performance del
re-layout al tipear.

```
flow TD
A["Gateway"]:primary --> B["Auth"]:warning
A --> C["Cart"]:info
A --> D["Search"]:info
A --> E["Recs"]:muted
B --> F["Session"]:secondary
C --> F
C --> G["Pricing"]:success
D --> G
E --> G
F --> H["Response"]:success
G --> H
B --> H
```

## Git

### 7. Branches + merges + mensaje largo (el caso que encontró el bug de ids)

Mirar: 9 commits (ninguno perdido — el `m2` del usuario no colisiona con los
auto-ids de merges), main estable en su lane, el mensaje larguísimo truncado
con "…" a 420px, y con **lane gap > 0** las lanes más separadas. Probar
también los toggles HORIZ / LEFT.

```
commit a1 (Ana) : Initial commit
branch feature/one
commit f1 (Beto) : one: start
checkout main
commit m2 (Ana) : main work
branch feature/two
commit t1 (Caro) : two: an extremely long commit subject line that would definitely overflow any badge width
checkout main
merge feature/one : merge one
checkout feature/two
commit t2 (Caro) : two: more
checkout main
merge feature/two : merge two
branch hotfix
commit h1 (Dani) : hotfix: urgent
checkout main
merge hotfix : merge hotfix
```

### 8. Octopus + phantom rebase (el seed histórico)

Mirar: merge de 3 parents sin edges rotos.

```
commit root : Base
branch alpha
commit a1 (Ana) : alpha work
checkout main
branch beta
commit b1 (Beto) : beta work
checkout main
branch gamma
commit g1 (Caro) : gamma work
checkout main
merge alpha : land alpha
merge beta : land beta
merge gamma : land gamma
```

## Sequence

### 9. Roles + self-messages + notas

Mirar: lifelines, mensajes async punteados, self-loops, notas spanning.

```
sequence
participant U ["User"]:primary
participant S ["Server"]:secondary
participant Q ["Queue"]:info

U ->> S : POST /checkout
S ->> S : validate cart
S -->> Q : enqueue payment job
Note over Q : retries with backoff
Q -->> S : job done
S -->> U : 200 OK
Note over U,S : end-to-end under 300ms
```

## Block

### 10. Wireframe con spans

Mirar: grid de 4 columnas, spans correctos, roles pintando celdas.

```
block
columns 4

Nav["Navigation"]:primary :4
Side["Sidebar"]:muted
Hero["Hero"]:info :3
Feed["Feed"]:ghost :2
Ads["Ads"]:warning
Chat["Chat"]:success
Foot["Footer"]:neutral :4
```
