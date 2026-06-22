/**
 * Seed programs for the sequence and block playground modes — the source the
 * editor starts with. The flow and git seeds live next to their parsers
 * (`flow-dsl.ts` / `dsl.ts`); these two only need a starting string since their
 * parsers come straight from `@joycostudio/trazo`.
 */

/** Default sequence-diagram program: a request/response with a note + self-call. */
export const SEED_SEQUENCE = `# playground — sequence mode
# messages: A ->> B sync   A -->> B async (dashed)   A ->> A self-loop
# Note over A,B : text
sequence
participant C ["Client"]:primary
participant S ["Server"]

C ->> S : GET /cart
Note over S : reads cache
S -->> C : 200 OK
C ->> C : hydrate
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
