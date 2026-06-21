import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "react/index": "src/react/index.ts",
    "eslint/index": "src/eslint/index.ts",
  },
  format: ["esm"],
  dts: true,
  clean: true,
  treeshake: true,
  // react is an optional peer — never bundle it into core.
  external: ["react", "react-dom", "react/jsx-runtime"],
});
