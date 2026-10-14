import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const config = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    ignores: [".next/**", ".open-next/**", ".wrangler/**", "node_modules/**", "cloudflare-env.d.ts", "next-env.d.ts"],
  },
];

export default config;
