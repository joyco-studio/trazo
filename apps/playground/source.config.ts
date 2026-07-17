import { defineDocs, defineConfig } from "fumadocs-mdx/config";
import { remarkTrazo } from "@joycostudio/trazo/remark";

import { remarkTrazoDiagram } from "./src/lib/remark-trazo-diagram";

export const docs = defineDocs({ dir: "content/docs" });

export default defineConfig({
  mdxOptions: {
    // `remarkTrazo` validates every fenced flow/git/seq/block block and fails
    // the build on a parse error (with a source-accurate line); `remarkTrazoDiagram`
    // then rewrites the valid fences into live `<TrazoDiagram>` SVGs.
    remarkPlugins: [remarkTrazo, remarkTrazoDiagram],
  },
});
