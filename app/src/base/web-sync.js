const Log = require('../utils/log');
const api = require('./api');
const TaskTracker = require('./task-tracker');
const { db } = require('../models');

const log = new Log('WebSync');

let pollTimer = null;
let _startedExternally = false;
let _stoppedExternally = false;
let _externalWebSession = false; // true if the running session was started by the web
let _lastKnownTaskId = null;     // server task_id of the last known session (to detect switches)

async function callApiPost(path, body) {
  try {
    await api.post(path, body || {});
  } catch (err) {
    log.warning(`WebSync API call failed (${path}): ${err}`);
  }
}

async function pollOnce() {
  let srv = null;
  try {
    const res = await api.post('tracking/current', {});
    srv = (res && res.success && res.response && res.response.data) ? res.response.data : null;
  } catch (err) {
    return;
  }

  const desktopTracking = TaskTracker.isActive;

  if (srv && !desktopTracking) {
    // External start: server has a session, desktop is idle
    const localTask = await db.models.Task.findOne({
      where: { externalId: String(srv.task_id) },
    });
    if (!localTask) {
      log.warning(`WebSync: task ${srv.task_id} not found — syncing tasks`);
      try {
        const Tasks = require('../controller/tasks');
        await Tasks.syncTasks(false, false, true);
        const retried = await db.models.Task.findOne({ where: { externalId: String(srv.task_id) } });
        if (!retried) {
          log.warning(`WebSync: task ${srv.task_id} still not found after sync, skipping`);
          return;
        }
        log.debug(`WebSync: task found after sync — starting tracker`);
        _startedExternally = true;
        _externalWebSession = srv.owner === 'web';
        _lastKnownTaskId = srv.task_id;
        try {
          await TaskTracker.start(retried.id);
        } catch (err) {
          log.warning(`WebSync: TaskTracker.start after sync failed: ${err}`);
        }
      } catch (err) {
        log.warning(`WebSync: task sync failed: ${err}`);
      } finally {
        _startedExternally = false;
      }
      return;
    }
    log.debug(`WebSync: external start detected — task "${srv.task_name}" (owner: ${srv.owner})`);
    _startedExternally = true;
    _externalWebSession = srv.owner === 'web';
    _lastKnownTaskId = srv.task_id;
    try {
      await TaskTracker.start(localTask.id);
    } catch (err) {
      log.warning(`WebSync: TaskTracker.start failed: ${err}`);
    }
    _startedExternally = false;

  } else if (!srv && desktopTracking) {
    // External stop: server session gone, desktop still running
    log.debug(`WebSync: external stop detected (was web session: ${_externalWebSession})`);
    _stoppedExternally = true;
    const pushInterval = !_externalWebSession; // if web-owned session: web logged it, don't double-log
    try {
      await TaskTracker.stop(pushInterval);
    } catch (err) {
      log.warning(`WebSync: TaskTracker.stop failed: ${err}`);
    }
    _stoppedExternally = false;
    _externalWebSession = false;
    _lastKnownTaskId = null;

  } else if (srv && desktopTracking && srv.task_id !== _lastKnownTaskId && _lastKnownTaskId !== null) {
    // Task switched externally
    const localTask = await db.models.Task.findOne({
      where: { externalId: String(srv.task_id) },
    });
    if (!localTask) return;
    log.debug(`WebSync: external task switch to "${srv.task_name}"`);
    _startedExternally = true;
    _externalWebSession = srv.owner === 'web';
    _lastKnownTaskId = srv.task_id;
    try {
      await TaskTracker.start(localTask.id);
    } catch (err) {
      log.warning(`WebSync: TaskTracker.start (switch) failed: ${err}`);
    }
    _startedExternally = false;
  } else if (srv && desktopTracking) {
    _lastKnownTaskId = srv.task_id;
  }
}

function startSync() {
  if (pollTimer) return;
  log.debug('WebSync: starting 1-second poll');
  pollTimer = setInterval(pollOnce, 1000);
}

function stopSync() {
  if (!pollTimer) return;
  clearInterval(pollTimer);
  pollTimer = null;
  log.debug('WebSync: polling stopped');
}

// ── Hook into TaskTracker events to notify the server ────────────────────────

TaskTracker.on('started', async taskId => {
  if (_startedExternally) return;
  const task = await db.models.Task.findByPk(taskId).catch(() => null);
  if (!task) return;
  const startAt = TaskTracker.currentInterval.startedAt;
  _lastKnownTaskId = Number(task.externalId);
  _externalWebSession = false;
  await callApiPost('tracking/start', {
    task_id:  Number(task.externalId),
    start_at: startAt ? startAt.toISOString() : new Date().toISOString(),
    owner:    'desktop',
  });
});

TaskTracker.on('switched', async taskId => {
  if (_startedExternally) return;
  const task = await db.models.Task.findByPk(taskId).catch(() => null);
  if (!task) return;
  const startAt = TaskTracker.currentInterval.startedAt;
  _lastKnownTaskId = Number(task.externalId);
  _externalWebSession = false;
  await callApiPost('tracking/start', {
    task_id:  Number(task.externalId),
    start_at: startAt ? startAt.toISOString() : new Date().toISOString(),
    owner:    'desktop',
  });
});

TaskTracker.on('stopped', async () => {
  if (_stoppedExternally) return;
  _lastKnownTaskId = null;
  _externalWebSession = false;
  await callApiPost('tracking/stop', {});
});

module.exports = { startSync, stopSync };