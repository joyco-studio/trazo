/**
 * Seed programs for the sequence and block playground modes — the source the
 * editor starts with. The flow and git seeds live next to their parsers
 * (`flow-dsl.ts` / `dsl.ts`); these two only need a starting string since their
 * parsers come straight from `@joycostudio/trazo`.
 */

/**
 * Default sequence-diagram program — the PPR "Don't await. Forward." flow from
 * JOYCO log 07: the server fans out work and streams results while the client
 * renders progressively. Exercises self-messages, sync + async (`-->>`, dashed)
 * arrows, and single- and multi-participant notes.
 */
export const SEED_SEQUENCE = `# playground — sequence mode
# messages: A ->> B sync   A -->> B async (dashed)   A ->> A self-loop
# Note over A : text        Note over A,B : spanning note
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
`;

/** Default block-grid program: a page-layout wireframe with column spans. */
export const SEED_BLOCK = `# playground — block mode
# columns N sets the grid width; ":N" after a cell is its column span
block
columns 3

Nav["Navigation"] :3
Side["Sidebar"]
Main["Content"] :2
Footer["Footer"] :3
`;
