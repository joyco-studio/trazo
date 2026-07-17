import { defineDocs, defineConfig } from "fumadocs-mdx/config";
import { remarkTrazoRender } from "@joycostudio/trazo/remark";

export const docs = defineDocs({ dir: "content/docs" });

export default defineConfig({
  mdxOptions: {
    // Validates every fenced flow/git/seq/block block (failing the build on a
    // parse error with a source-accurate line) and rewrites the valid ones into
    // live `<TrazoDiagram>` SVGs, forwarding fence meta (`title="…"`) as props
    // and stamping a per-document `index` on each diagram.
    remarkPlugins: [[remarkTrazoRender, { componentName: "TrazoDiagram", numberAttr: "index" }]],
  },
});
