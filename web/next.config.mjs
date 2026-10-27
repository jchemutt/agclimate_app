/** @type {import('next').NextConfig} */
const api = process.env.API_URL || "http://127.0.0.1:8000";
export default {
  output: "standalone",
  reactStrictMode: true,
  // In production Caddy sends /api to the API directly; this rewrite covers
  // `next dev` and running the web container on its own.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${api}/api/:path*` }];
  },
};
