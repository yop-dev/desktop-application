const Log = require('../utils/log');
const api = require('./api');
const TaskTracker = require('./task-tracker');
const { db } = require('../models');
const Authentication = require('./authentication');
const IntervalsController = require('../controller/time-intervals');

const log = new Log('WebSync');

let pollTimer = null;
let _startedExternally = false;
let _stoppedExternally = false;
let _externalWebSession = false;   // true if the running session was started by the web
let _lastKnownTaskId = null;       // server task_id of the last known session (to detect switches)
let _externalStartAt = null;       // server start_at when session was started externally (for timer sync)
let _externalStopCount = 0;        // consecutive null polls — stop only after STOP_DEBOUNCE
let _externalStartInProgress = false; // mutex: prevent concurrent external-start handling
let _lastPushedGapStartAt = null;  // track which session's gap we already pushed (prevent duplicates)

const STOP_DEBOUNCE = 2;         // require 2 consecutive null responses before stopping desktop
const GAP_THRESHOLD_SECONDS = 30; // min gap (seconds) between web start_at and desktop detection to trigger a catch-up interval

async function callApiPost(path, body) {
  try {
    await api.post(path, body || {});
  } catch (err) {
    log.warning(`WebSync API call failed (${path}): ${err}`);
  }
}

// Push a catch-up interval for the period the web session was running before the desktop detected it.
// startAt / endAt are Date objects or ISO strings.
async function pushGapInterval(taskId, startAt, endAt) {
  const gapSeconds = Math.floor((new Date(endAt) - new Date(startAt)) / 1000);
  if (gapSeconds < GAP_THRESHOLD_SECONDS) return;

  try {
    const currentUser = await Authentication.getCurrentUser();
    await IntervalsController.pushTimeInterval({
      task_id:       taskId,
      user_id:       currentUser.id,
      start_at:      new Date(startAt).toISOString(),
      end_at:        new Date(endAt).toISOString(),
      activity_fill: 0,
      keyboard_fill: null,
      mouse_fill:    null,
    }, null);
    log.debug(`WebSync: pushed gap interval (${gapSeconds}s) from ${startAt} to ${endAt}`);
  } catch (err) {
    log.warning(`WebSync: failed to push gap interval: ${err}`);
  }
}

async function pollOnce() {
  let srv = null;
  try {
    const res = await api.post('tracking/current', {});
    // api.post returns {success:false} on network/API errors rather than throwing.
    // Treat any non-success response as a transient failure — skip the poll so that
    // STOP_DEBOUNCE only counts definitive "no session" responses, not network blips.
    if (!res || !res.success) return;
    srv = (res.response && res.response.data) ? res.response.data : null;
  } catch (err) {
    return;
  }

  const desktopTracking = TaskTracker.isActive;

  if (srv) _externalStopCount = 0;

  if (srv && !desktopTracking) {
    // External start: server has a session, desktop is idle.
    // Mutex: only one poll may run the start routine at a time.
    if (_externalStartInProgress) return;
    _externalStartInProgress = true;
    try {
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
          if (srv.start_at !== _lastPushedGapStartAt) {
            _lastPushedGapStartAt = srv.start_at;
            await pushGapInterval(srv.task_id, srv.start_at, new Date());
          }
          _startedExternally = true;
          _externalWebSession = srv.owner === 'web';
          _lastKnownTaskId = srv.task_id;
          _externalStartAt = srv.start_at;
          try {
            await TaskTracker.start(retried.id);
          } catch (err) {
            log.warning(`WebSync: TaskTracker.start after sync failed: ${err}`);
          }
          _externalStartAt = null;
        } catch (err) {
          log.warning(`WebSync: task sync failed: ${err}`);
        } finally {
          _startedExternally = false;
        }
        return;
      }
      log.debug(`WebSync: external start detected — task "${srv.task_name}" (owner: ${srv.owner})`);
      if (srv.start_at !== _lastPushedGapStartAt) {
        _lastPushedGapStartAt = srv.start_at;
        await pushGapInterval(srv.task_id, srv.start_at, new Date());
      }
      _startedExternally = true;
      _externalWebSession = srv.owner === 'web';
      _lastKnownTaskId = srv.task_id;
      _externalStartAt = srv.start_at;
      try {
        await TaskTracker.start(localTask.id);
      } catch (err) {
        log.warning(`WebSync: TaskTracker.start failed: ${err}`);
      }
      _startedExternally = false;
      _externalStartAt = null;
    } finally {
      _externalStartInProgress = false;
    }

  } else if (!srv && desktopTracking) {
    // External stop: require STOP_DEBOUNCE consecutive nulls before stopping
    // to avoid reacting to transient network blips or brief server hiccups
    if (++_externalStopCount < STOP_DEBOUNCE) return;
    _externalStopCount = 0;
    log.debug(`WebSync: external stop detected (was web session: ${_externalWebSession})`);
    _stoppedExternally = true;
    const pushInterval = true; // desktop always logs the tail; web stop handler no longer creates intervals
    try {
      await TaskTracker.stop(pushInterval);
    } catch (err) {
      log.warning(`WebSync: TaskTracker.stop failed: ${err}`);
    }
    _stoppedExternally = false;
    _externalWebSession = false;
    _lastKnownTaskId = null;
    // _lastPushedGapStartAt intentionally NOT cleared here — if the same web session
    // reappears after a transient stop (STOP_DEBOUNCE), we must not re-push the gap.

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
    _externalStartAt = srv.start_at;
    try {
      await TaskTracker.start(localTask.id);
    } catch (err) {
      log.warning(`WebSync: TaskTracker.start (switch) failed: ${err}`);
    }
    _startedExternally = false;
    _externalStartAt = null;
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
  _lastPushedGapStartAt = null;
  await callApiPost('tracking/stop', {});
});

module.exports = { startSync, stopSync, getExternalStartAt: () => _externalStartAt };