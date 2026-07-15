/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config, { dev }) => {
    // Docker Desktop bind-mounts (this project's dev setup - see
    // docker-compose.yml's `./frontend:/app` volume) don't reliably forward
    // native filesystem change events into the container on Windows hosts.
    // Without polling, webpack's watcher can silently miss edits entirely -
    // the dev server keeps serving an old compiled chunk indefinitely, which
    // surfaces later as a stale client bundle referencing a chunk hash the
    // server no longer has (ChunkLoadError) once some other change finally
    // does trigger a recompile and rotates the manifest.
    if (dev) {
      config.watchOptions = {
        poll: 1000,
        aggregateTimeout: 300,
      };
    }
    return config;
  },
};

module.exports = nextConfig;
