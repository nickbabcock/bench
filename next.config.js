/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    config.experiments.asyncWebAssembly = true;
    config.output.assetModuleFilename = `static/[hash][ext]`;
    config.output.publicPath = `/_next/`;
    config.module.rules.push({
      test: /\.(wasm|replay)$/,
      type: "asset/resource",
    });
    return config;
  }
}

module.exports = nextConfig
