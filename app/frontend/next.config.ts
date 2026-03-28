import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Disable Turbopack (issues with Japanese path names)
  // Use webpack instead

  output: 'standalone',

  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.googleusercontent.com' },
    ],
  },

  // Trailing slash for better compatibility
  trailingSlash: true,
};

export default nextConfig;
