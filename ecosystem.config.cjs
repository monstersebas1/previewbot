module.exports = {
  apps: [
    {
      name: "previewbot",
      script: "dist/server.js",
      cwd: "/opt/previewbot/app",
      node_args: "",
      env: {
        NODE_ENV: "production",
      },
      exp_backoff_restart_delay: 100,
      max_restarts: 10,
      watch: false,
      merge_logs: true,
      output: "/var/log/previewbot/app.log",
      error: "/var/log/previewbot/error.log",
    },
  ],
};
