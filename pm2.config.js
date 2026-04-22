// PM2 process config for portal-jai1 backend
// First-time setup:
//   npm install -g pm2
//   cd portal-jai1-backend
//   pm2 start pm2.config.js
//   pm2 save          (persist across reboots)
//   pm2 startup       (run the printed command to enable auto-start)
//
// Daily use:
//   pm2 status        — check process state
//   pm2 logs jai1-backend -- tail logs
//   pm2 restart jai1-backend
//   pm2 stop jai1-backend

module.exports = {
  apps: [
    {
      name: 'jai1-backend',
      script: 'cmd',
      args: '/c npm run start:dev',
      cwd: __dirname,
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      env: {
        NODE_ENV: 'development',
      },
    },
  ],
};
