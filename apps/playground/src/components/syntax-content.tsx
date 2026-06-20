/**
 * `<SyntaxContent>` — a React SERVER COMPONENT that renders the diagram syntax
 * reference (the same `public/syntax.md` served at `/syntax.md`).
 *
 * react-markdown + remark-gfm run HERE, on the server only. The component reads
 * the markdown file at render time (build time, since the page is static) and
 * emits a plain SVG/HTML tree, so NONE of the markdown machinery is shipped to
 * the client — the drawer shell that displays this tree is a separate client
 * island that only receives the already-rendered children.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Single source of truth: the file served verbatim at `/syntax.md`. */
const SYNTAX_PATH = path.join(process.cwd(), "public", "syntax.md");

export async function SyntaxContent() {
  const markdown = await readFile(SYNTAX_PATH, "utf8");

  return (
    <div
      data-slot="syntax-content"
      className="prose-syntax max-w-none text-sm leading-relaxed [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_blockquote]:border-border [&_blockquote]:text-muted-foreground [&_blockquote]:border-l-2 [&_blockquote]:pl-4 [&_code]:bg-muted [&_code]:rounded [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs [&_h1]:mt-0 [&_h1]:mb-4 [&_h1]:text-lg [&_h1]:font-semibold [&_h1]:tracking-wide [&_h1]:uppercase [&_h2]:border-border [&_h2]:mt-8 [&_h2]:mb-3 [&_h2]:border-t [&_h2]:pt-6 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:mt-6 [&_h3]:mb-2 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:tracking-wide [&_h3]:uppercase [&_hr]:border-border [&_hr]:my-8 [&_li]:my-1 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-3 [&_pre]:bg-muted [&_pre]:my-4 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:p-4 [&_pre]:text-xs [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_table]:my-4 [&_table]:w-full [&_table]:border-collapse [&_table]:text-xs [&_td]:border-border [&_td]:border [&_td]:px-3 [&_td]:py-1.5 [&_th]:border-border [&_th]:bg-muted [&_th]:border [&_th]:px-3 [&_th]:py-1.5 [&_th]:text-left [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-5"
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
    </div>
  );
}
