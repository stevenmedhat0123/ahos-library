import { boot } from './app.js';

boot().catch((e) => {
  console.error(e);
  const app = document.getElementById('app');
  if (app) {
    app.innerHTML = '<div style="padding:32px;font:16px system-ui;color:#F2EAD7;direction:ltr">Something went wrong while starting AHOS Library.<br><small style="opacity:.7">' + String(e && e.message || e).replace(/[<>&]/g, '') + '</small></div>';
  }
});
