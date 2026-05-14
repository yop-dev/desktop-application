/* eslint-disable global-require */
const { ipcMain } = require('electron');
const IPCRouter = require('@amazingcat/electron-ipc-router');
const Logger = require('../utils/log');

const log = new Logger('Router');
log.debug('Starting routes load');

// Creating instance of IPC router
const router = new IPCRouter(ipcMain);

// Expose router instance
module.exports.router = router;

// Proxy IPC.setWebContents method
module.exports.setWebContents = wc => router.setWebContents(wc);

const webSync = require('../base/web-sync');
const Authentication = require('../base/authentication');
// Start polling immediately — covers the case where the app starts with a saved token
// (the 'authenticated' event only fires on fresh login, not on token restore).
// pollOnce() silently no-ops when the API is unreachable or unauthenticated.
webSync.startSync();
Authentication.events.on('authenticated', () => webSync.startSync()); // idempotent
Authentication.events.on('logged-out', () => webSync.stopSync());

require('./authentication.js')(router);
require('./misc.js')(router);
require('./projects.js')(router);
require('./task-tracking.js')(router);
require('./tasks.js')(router);
require('./time.js')(router);
require('./translation.js')(router);
require('./user-preferences.js')(router);
require('./offline-mode.js')(router);
require('./intervals.js')(router);
