<template>
  <el-dialog
    :title="$t('Create Task')"
    :visible.sync="visible"
    width="380px"
    :close-on-click-modal="false"
    destroy-on-close
    @closed="reset"
  >
    <el-form
      ref="form"
      :model="form"
      :rules="rules"
      label-position="top"
    >

      <el-form-item
        :label="$t('Task Name')"
        prop="name"
      >
        <el-input
          v-model="form.name"
          :placeholder="$t('e.g. Design review')"
          @keyup.enter.native="submit"
        />
      </el-form-item>

      <el-form-item
        :label="$t('Project')"
        prop="projectId"
      >
        <el-autocomplete
          v-model="projectDisplayName"
          :fetch-suggestions="fetchProjectSuggestions"
          :placeholder="$t('Type to search or create a project')"
          :disabled="creatingProject"
          :debounce="0"
          :trigger-on-focus="true"
          value-key="label"
          style="width: 100%"
          @select="onProjectSelect"
        />
      </el-form-item>

    </el-form>

    <span slot="footer">
      <el-button @click="visible = false">
        {{ $t('Cancel') }}
      </el-button>
      <el-button
        type="primary"
        :loading="loading"
        @click="submit"
      >
        {{ $t('Create') }}
      </el-button>
    </span>
  </el-dialog>
</template>

<script>
export default {

  name: 'TaskCreateModal',

  data() {

    return {

      visible: false,
      loading: false,
      creatingProject: false,
      projectDisplayName: '',
      form: {
        name: '',
        projectId: null,
      },
      rules: {
        name: [{ required: true, message: this.$t('Task name is required'), trigger: 'blur' }],
        projectId: [{ required: true, message: this.$t('Project is required'), trigger: 'change' }],
      },

    };

  },

  computed: {

    internalProjects() {

      return this.$store.getters.projects.filter(p => p.source === 'internal');

    },

  },

  watch: {

    projectDisplayName(val) {

      if (!val)
        this.form.projectId = null;

    },

    'form.projectId'() {

      this.$nextTick(() => {

        if (this.$refs.form)
          this.$refs.form.validateField('projectId');

      });

    },

  },

  methods: {

    show() {

      this.visible = true;

    },

    reset() {

      this.form = { name: '', projectId: null };
      this.projectDisplayName = '';
      this.loading = false;
      this.creatingProject = false;
      if (this.$refs.form)
        this.$refs.form.resetFields();

    },

    fetchProjectSuggestions(query, callback) {

      const q = query.toLowerCase().trim();
      const matches = q
        ? this.internalProjects.filter(p => p.name.toLowerCase().includes(q))
        : this.internalProjects;

      const suggestions = matches.map(p => ({
        label: p.name,
        id: String(p.id),
        externalId: p.externalId,
      }));

      if (q && !this.internalProjects.some(p => p.name.toLowerCase() === q))
        suggestions.push({ label: `+ Create "${query}"`, id: '__create__', query });

      callback(suggestions);

    },

    onProjectSelect(item) {

      if (item.id === '__create__') {

        this.projectDisplayName = '';
        this.form.projectId = null;
        this.createProject(item.query);

      } else {

        this.form.projectId = item.id;
        this.projectDisplayName = item.label;

      }

    },

    async createProject(name) {

      if (!name.trim()) return;

      this.creatingProject = true;

      try {

        const result = await this.$ipc.request('projects/create', { name: name.trim() });

        if (result.code !== 200) {

          this.$message({ type: 'error', message: `${this.$t('Failed to create project')} (${result.code})` });
          return;

        }

        const createdExternalId = String(result.body.project.externalId);

        const projectsRes = await this.$ipc.request('projects/sync', {});
        await this.$store.dispatch('syncProjects', projectsRes.body);

        const synced = this.$store.getters.projects.find(p => String(p.externalId) === createdExternalId);

        if (synced) {

          this.form.projectId = String(synced.id);
          this.projectDisplayName = synced.name;

        } else {

          this.$message({ type: 'error', message: this.$t('Project was created but could not be selected') });

        }

      } catch (err) {

        this.$message({ type: 'error', message: `${this.$t('Error creating project')}: ${err.message || err}` });

      } finally {

        this.creatingProject = false;

      }

    },

    async submit() {

      const valid = await new Promise(resolve => this.$refs.form.validate(ok => resolve(ok)));
      if (!valid)
        return;

      this.loading = true;

      try {

        const result = await this.$ipc.request('tasks/create', {
          name: this.form.name,
          projectId: [this.form.projectId],
          description: '',
        });

        if (result.code === 403) {

          this.$msgbox({
            title: this.$t('Task create error'),
            message: this.$t('Insufficient permissions to create task in this project'),
            confirmButtonText: this.$t('OK'),
          });
          return;

        }

        if (result.code !== 200) {

          this.$message({ type: 'error', message: `${this.$t('Failed to create task')} (${result.code})` });
          return;

        }

        const project = this.$store.getters.projects.find(p => String(p.id) === this.form.projectId);
        const newTask = Object.assign({}, result.body.task, {
          status: '1',
          TrackedTime: 0,
          Tracks: [],
          Project: project || null,
        });
        this.$store.dispatch('syncTasks', { tasks: [newTask, ...this.$store.getters.tasks] });
        const totalTime = await this.$ipc.request('time/total', {});
        this.$store.dispatch('totalTimeSync', totalTime.body);

        this.$emit('created', result.body.task);
        this.visible = false;

      } catch (err) {

        this.$message({ type: 'error', message: `${this.$t('Error during task creation')}: ${err.message || err}` });

      } finally {

        this.loading = false;

      }

    },

  },

};
</script>
