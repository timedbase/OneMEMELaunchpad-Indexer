/**
 * PM2 ecosystem config — production
 *
 * Runs both processes inside the Docker container:
 *   - ponder   : BSC indexer (writes to PostgreSQL)
 *   - api      : NestJS REST API (reads from PostgreSQL, serves :3001)
 *
 * PM2 restarts either process automatically on crash and streams
 * merged logs to stdout (visible via `docker logs`).
 */

module.exports = {
  apps: [
    {
      name:         "ponder",
      script:       "node_modules/.bin/ponder",
      args:         "start",
      cwd:          "/app",
      autorestart:  true,
      restart_delay: 5000,       // wait 5 s before restarting on crash
      max_restarts: 10,
      env: {
        NODE_ENV: "production",
      },
      // Stream logs to stdout so `docker logs` captures them
      out_file: "/dev/stdout",
      error_file: "/dev/stderr",
      merge_logs: true,
    },
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
