import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const backendOrigin = process.env.BACKEND_ORIGIN ?? "http://localhost:8000";

const config: NextConfig = {
  reactStrictMode: true,
  // Disable Next's response compression. SSE endpoints (`/api/**/stream`,
  // model-test, AG-UI chat) must flush per-frame; gzip buffers 16-64 KB
  // before emitting, collapsing reasoning/text chunks into one huge burst at
  // RUN_FINISHED. See learnings.md L05 · "SSE 必须 identity,不准 gzip".
  compress: false,
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${backendOrigin}/api/:path*`,
      },
    ];
  },
};

export default withNextIntl(config);
