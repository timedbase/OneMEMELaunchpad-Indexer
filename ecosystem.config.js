/**
 * PM2 ecosystem config — production
 *
 * Runs the NestJS REST API inside the Docker container.
 * On-chain data is served by The Graph subgraph (SUBGRAPH_URL).
 * Off-chain data (points, referrals, chat) is stored in PostgreSQL (DATABASE_URL).
 *
 * PM2 restarts the process automatically on crash and streams
 * logs to stdout (visible via `docker logs`).
 */

module.exports = {
  apps: [
    {
      name:         "api",
      script:       "dist/api/main.js",
      cwd:          "/app",
      autorestart:  true,
      restart_delay: 3000,
      max_restarts: 10,
      env: {
        NODE_ENV: "production",
      },
      out_file:   "/dev/stdout",
      error_file: "/dev/stderr",
      merge_logs: true,
    },
  ],
};
