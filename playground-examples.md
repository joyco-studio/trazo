# Trazo playground — ejemplos para probar

Pegá cada bloque en el editor del modo correspondiente. Todos están validados contra
los parsers reales (`parseFlow` / `parseSequence` / `parseBlock`).

> Nota sobre saltos de línea: en una etiqueta, escribí `\n` (barra + n) o `<br>` para
> forzar un salto. El editor es de una línea por sentencia, así que el `\n` es literal.

---

## Flowchart mode

### 1. Flechas: dirigida / sin flecha / bidireccional

```
flow LR
A["Request"] --> B["Handler"]
C["Cache"] --- D["Store"]
E["Client"]:primary <--> F["Server"]
G["Sync A"]:success <==> H["Sync B"]
A ==> I["Colored"]:success
```

- `-->` flecha dirigida (neutra) · `==>` dirigida con color del nodo origen
- `---` sin flecha (asociación) · `===` sin flecha con color
- `<-->` bidireccional (flecha en los dos extremos) · `<==>` bidireccional con color

### 2. Etiquetas multi-línea

```
flow TD
A["Build step\nruns at deploy"]:primary --> B["Bundle<br>and minify"]
B --> C["Ship"]:success
```

La caja crece en alto y se dimensiona según la línea más ancha. Sirve `\n` y `<br>`.

### 3. Subgraphs (TD — top-down)

```
flow TD
subgraph Build ["Build time"]
A["Compile"] --> B["Bundle"]
end
subgraph Request ["Request time"]
C["Render"] --> D["Stream"]:streamed
end
B --> C
```

El título queda en la franja superior de cada caja; los nodos del grupo se mantienen juntos.

### 4. Subgraphs (LR — left-right)

```
flow LR
subgraph API ["API layer"]
A["Route"] --> B["Controller"]
end
subgraph DB ["Data"]
C[("Postgres")]
end
B --> C
```

En LR el título también va arriba (mismo lugar que en TD).

### 5. Decisión con etiquetas de rama y loop de reintento

```
flow TD
A(["Start"]):primary --> B{"Cache hit?"}
B -->|"yes"| C["Serve"]:success
B -->|"no"| D["Fetch"]:warning
D --> B
```

`B --> D --> B` es un back-edge (loop): el motor lo rutea por el costado sin pisar la flecha de ida.

---

## Sequence mode

### PPR — "Don't await. Forward." (log 07)

```
sequence
participant S ["Server"]:primary
participant C ["Client"]

S ->> S : Start getCart()
S ->> S : Start getFlags()
S ->> C : Static shell + fallbacks (instant)
C ->> C : Display shell + hydrate static parts
Note over C : Users see content immediately
S -->> C : Stream flags data
C ->> C : CheckoutButton resolves
S -->> C : Stream cart data
C ->> C : CartCount + CartTotal pop in
Note over S,C : Fast TTFB, progressive render
```

- `->>` mensaje síncrono (línea sólida) · `-->>` asíncrono (línea punteada)
- `A ->> A` self-message (loop sobre la lifeline) — conserva sync/async
- `Note over A : texto` nota sobre un participante · `Note over A,B : texto` abarca A..B
- Las notas caen en su **fila temporal** (entre los mensajes, según el orden de las líneas), no en una columna aparte

---

## Block mode

### Grilla de layout (wireframe estilo `block-beta`)

```
block
columns 3
Nav["Navigation"] :3
Side["Sidebar"]
Main["Content"] :2
Footer["Footer"] :3
```

- `columns N` define el ancho de la grilla
- `:N` después de una celda es el span de columnas (sin `:` = span 1)
- Las celdas fluyen de izquierda a derecha y bajan de fila cuando no entran
- Roles (`:success`, `:primary`, …) también funcionan en las celdas
