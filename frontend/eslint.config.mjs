import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    // eslint-plugin-react (bundled in eslint-config-next) calls
    // context.getFilename() when react.version is "detect", but that API
    // was removed in ESLint 9+.  Pinning the version here skips the
    // auto-detection path and eliminates the TypeError at lint time.
    settings: {
      react: { version: "19.2.0" },
    },
  },
]);

export default eslintConfig;
