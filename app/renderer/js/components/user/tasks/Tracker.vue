<template>
    <div
        v-if="trackingInProgress && trackingTask"
        class="tracker-card"
    >
        <div class="tracker-card__info">
            <p class="tracker-card__task" @click="openTask">{{ trackingTask.name }}</p>
            <p class="tracker-card__project" @click="openProject">
                <span class="tracker-card__dot" />
                {{ projectName }}
            </p>
        </div>
        <div class="tracker-card__controls">
            <span class="tracker-card__time">{{ trackedTime }}</span>
            <button
                :disabled="trackingLoad"
                class="tracker-card__stop"
                @click="track"
            >
                <span class="tracker-card__stop-icon" />
            </button>
        </div>
    </div>
</template>

<script>
import {clipboard} from 'electron';

export default {
    name: 'Tracker',
    components: {},
    props: {
        isTrackerLoading: Boolean,
    },
    data() {

        return {
            errorModal: false,
            reportSnack: false,
            trackButtonLocked: false,
            sessionStartMs: null,
            sessionSeconds: 0,
            _sessionTimer: null,
        };

    },

    watch: {
        trackingInProgress(val) {
            if (val) {
                this._startSessionTimer();
            } else {
                this._stopSessionTimer();
            }
        },
        // Reset timer when task switches while tracking
        '$store.getters.task'(newId, oldId) {
            if (newId !== oldId && this.trackingInProgress) {
                this._startSessionTimer();
            }
        },
    },

    computed: {

        trackingLoad() {

            return this.$store.getters.trackLoad;

        },

        trackingInProgress() {

            return this.$store.getters.trackStatus;

        },

        trackingTask() {

            if (!this.$store.getters.task)
                return false;


            return this.getTask(this.$store.getters.task);

        },

        trackedTime() {

            return new Date(this.sessionSeconds * 1000).toISOString().substr(11, 8);

        },

        projectName() {

            if (this.trackingTask.Project === null)

                return '';


            return this.trackingTask.Project.name;

        },

    },

    mounted() {

        this.$ipc.serve('inactivity-modal/resume-work-after-inactivity', async () => {

            await this.track();

        });

        if (this.trackingInProgress) {
            this._startSessionTimer();
        }

    },

    beforeDestroy() {

        this._stopSessionTimer();

    },

    methods: {

        _startSessionTimer() {
            this._stopSessionTimer();
            const serverStartAt = this.$store.getters.trackingStartAt;
            this.sessionStartMs = serverStartAt ? new Date(serverStartAt).getTime() : Date.now();
            this.sessionSeconds = Math.floor((Date.now() - this.sessionStartMs) / 1000);
            this._sessionTimer = setInterval(() => {
                this.sessionSeconds = Math.floor((Date.now() - this.sessionStartMs) / 1000);
            }, 1000);
        },

        _stopSessionTimer() {
            if (this._sessionTimer) {
                clearInterval(this._sessionTimer);
                this._sessionTimer = null;
            }
            this.sessionSeconds = 0;
            this.sessionStartMs = null;
        },

        /**
         * Opens this task details
         */
        openTask() {

            this.$emit('load-task-position', null);

            // Avoid duplicated navigation
            if (this.$route.name === 'user.task' && this.$route.params.id === this.trackingTask.id)
                return;

            this.$router.push({name: 'user.task', params: {id: this.trackingTask.id}});

        },

        openProject() {

            this.$emit('load-task-position', null);

            // Avoid duplicated navigation
            if (this.$route.name === 'user.project' && this.$route.params.id === this.trackingTask.Project.id)
                return;

            this.$router.push({name: 'user.project', params: {id: this.trackingTask.Project.id}});

        },

        /**
         * Opens intervals queue
         */
        openIntervalsQueue() {

            this.$emit('load-task-position', null);

            // Make this button acting as "toggle" between intervals and main pages
            if (this.$route.name === 'user.intervalsQueue') {

                this.$router.push({name: 'user.tasks'});
                return;

            }

            this.$router.push({name: 'user.intervalsQueue'});

        },

        async resumeTracking() {

            if (!this.$store.getters.task || this.$store.getters.trackStatus)
                await this.$store.dispatch('stopTrack', {$ipc: this.$ipc})
                    .catch(error => {

                    // Stop tracking
                    this.trackButtonLocked = false;

                    const h = this.$createElement;
                    const messageContainer = h('div', null, [
                        h('p', null, error.message ? this.$t(error.message) : "Unknown error occured"),
                    ]);

                    if (error.error?.isApiError && error.error.trace_id) {
                        messageContainer.children.push(
                            h('p', null, [
                                h('b', null, 'Backend traceId'),
                                h('span', null, `: ${error.error.trace_id}`)
                            ])
                        );
                    }

                    if (error.error?.context?.client_trace_id) {
                        messageContainer.children.push(
                            h('p', null, [
                                h('b', null, 'Client traceId'),
                                h('span', null, `: ${error.error.context.client_trace_id}`)
                            ])
                        );
                    }

                    // Show error message
                    this.$alert(
                        messageContainer,
                        `${this.$t('Tracking error')} ${error.id || ''}`,
                        {
                            confirmButtonText: 'OK', callback: () => {
                            }
                        },
                    );

                });
            else
                await this.$store.dispatch('startTrack', {taskId: this.$store.getters.task, $ipc: this.$ipc});

        },

        async getReport() {

            this.$store.dispatch('showLoader');
            const {body} = await this.$ipc.request('time/daily-report', {});

            // Report buffer contains prepared report
            let reportBuffer = '';

            body.projects.forEach(project => {

                // Add project name
                reportBuffer += `**${project.name}**\n\n`;

                // Add all related tasks
                project.tasks.forEach(task => {

                    reportBuffer += `_${task.name.trim()}${task.url ? ` (${task.url})` : ''}_\n...\n\n`;

                });

            });

            this.$store.dispatch('hideLoader');

            clipboard.writeText(reportBuffer);
            this.reportSnack = true;

        },

        track() {

            // Double-click protection
            if (this.trackButtonLocked)
                return;
            this.trackButtonLocked = true;

            if (!this.$store.getters.task || this.$store.getters.trackStatus)
                this.$store
                    .dispatch('stopTrack', {$ipc: this.$ipc})
                    .then(() => {
                        // Allow click only after some amount of time
                        setTimeout(() => this.$set(this, 'trackButtonLocked', false), 350);
                    })
                    .catch(error => {

                        // Stop tracking
                        this.trackButtonLocked = false;

                        const h = this.$createElement;
                        const messageContainer = h('div', null, [
                            h('p', null, error.message || 'Unknown error occured')
                        ]);

                        if (error.error?.isApiError && error.error.trace_id) {
                            messageContainer.children.push(
                                h('p', null, [
                                    h('b', null, 'Backend traceId'),
                                    h('span', null, `: ${error.error.trace_id}`)
                                ])
                            );
                        }

                        if (error.error?.context?.client_trace_id) {
                            messageContainer.children.push(
                                h('p', null, [
                                    h('b', null, 'Client traceId'),
                                    h('span', null, `: ${error.error.context.client_trace_id}`)
                                ])
                            );
                        }

                        // Show error message
                        this.$alert(
                            messageContainer,
                            `${this.$t('Tracking error')} ${error.id || ''}`,
                            {
                                confirmButtonText: 'OK', callback: () => {
                                }
                            },
                        );

                    });
            else
                this.$store
                    .dispatch('startTrack', {taskId: this.$store.getters.task, $ipc: this.$ipc})
                    .then(() => {
                        // Allow click only after some amount of time
                        setTimeout(() => this.$set(this, 'trackButtonLocked', false), 350);
                    })
                    .catch(error => {
                        this.$set(this, 'trackButtonLocked', false)
                        const h = this.$createElement;
                        const messageContainer = h('div', null, [
                            h('p', null, error.message || 'Unknown error occured')
                        ]);

                        if (error.error?.isApiError && error.error.trace_id) {
                            messageContainer.children.push(
                                h('p', null, [
                                    h('b', null, 'Backend traceId'),
                                    h('span', null, `: ${error.error.trace_id}`)
                                ])
                            );
                        }

                        if (error.error?.context?.client_trace_id) {
                            messageContainer.children.push(
                                h('p', null, [
                                    h('b', null, 'Client traceId'),
                                    h('span', null, `: ${error.error.context.client_trace_id}`)
                                ])
                            );
                        }

                        // Show error message
                        this.$alert(
                            messageContainer,
                            `${this.$t('Tracking is not available')} ${error.id || ''}`,
                            {
                                confirmButtonText: 'OK', callback: () => {
                                }
                            },
                        );

                    });

        },


        getTask(taskId) {

            return this.$store.getters.tasks.find(t => t.id === taskId);

        },
    },
};
</script>

<style lang="scss" scoped>
p { margin: 0; }

.tracker-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #e8f4fd;
  border-bottom: 1px solid #c5e0f5;
  padding: 10px 16px;
  flex-shrink: 0;

  &__info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    overflow: hidden;
    flex: 1;
    min-width: 0;
  }

  &__task {
    font-size: 13px;
    font-weight: 600;
    color: #1a2b3c;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: pointer;
    &:hover { color: #0073ea; }
  }

  &__project {
    font-size: 11px;
    color: #5f7a96;
    display: flex;
    align-items: center;
    gap: 5px;
    cursor: pointer;
    &:hover { color: #0073ea; }
  }

  &__dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #0073ea;
    flex-shrink: 0;
    display: inline-block;
  }

  &__controls {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
    margin-left: 12px;
  }

  &__time {
    font-size: 16px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: #1a2b3c;
    letter-spacing: 0.5px;
  }

  &__stop {
    width: 30px;
    height: 30px;
    border-radius: 50%;
    background: #e04f4f;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: background 0.15s;
    padding: 0;

    &:hover:not(:disabled) { background: #c0392b; }
    &:disabled { opacity: 0.5; cursor: not-allowed; }
  }

  &__stop-icon {
    width: 10px;
    height: 10px;
    background: #fff;
    border-radius: 1px;
    display: block;
  }
}

</style>
