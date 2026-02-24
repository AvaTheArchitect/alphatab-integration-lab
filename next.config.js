const { AlphaTabWebPackPlugin } = require("@coderline/alphatab-webpack");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
        ],
      },
    ];
  },
  webpack: (config) => {
    // This plugin handles the worker and soundfont assets automatically
    config.plugins.push(new AlphaTabWebPackPlugin());
    return config;
  },
};

module.exports = nextConfig;
