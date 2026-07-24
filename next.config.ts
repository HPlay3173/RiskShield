import type { NextConfig } from "next";
import { RESPONSE_SECURITY_HEADERS } from "./lib/security-headers";

const nextConfig: NextConfig = {
  async headers() {
    return [{
      source: "/:path*",
      headers: Object.entries(RESPONSE_SECURITY_HEADERS).map(([key, value]) => ({ key, value })),
    }];
  },
};

export default nextConfig;
