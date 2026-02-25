import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Disable Turbopack (issues with Japanese path names)
  // Use webpack instead

  // Cloudflare Pages deployment settings
  output: 'export',

  // Disable image optimization for static export
  images: {
    unoptimized: true,
  },

  // Trailing slash for better compatibility
  trailingSlash: true,
};

export default nextConfig;
