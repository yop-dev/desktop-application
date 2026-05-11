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
        <el-select
          v-model="form.projectId"
          :placeholder="$t('Type to search or create a project')"
          filterable
          :filter-method="filterProjects"
          :default-first-option="false"
          :loading="creatingProject"
          :disabled="creatingProject"
          style="width: 100%"
          @change="onProjectChange"
        >
          <el-option
            v-for="project in filteredProjects"
            :key="project.id"
            :label="project.name"
            :value="String(project.id)"
          />
          <el-option
            v-if="showCreateOption"
            key="__create__"
            :label="createOptionLabel"
            value="__create__"
          />
        </el-select>
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
      projectFilterQuery: '',
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

    filteredProjects() {

      if (!this.projectFilterQuery.trim()) return this.internalProjects;
      const q = this.projectFilterQuery.toLowerCase();
      return this.internalProjects.filter(p => p.name.toLowerCase().includes(q));

    },

    showCreateOption() {

      if (!this.projectFilterQuery.trim()) return false;
      const q = this.projectFilterQuery.toLowerCase();
      return !this.internalProjects.some(p => p.name.toLowerCase() === q);

    },

    createOptionLabel() {

      return `+ Create "${this.projectFilterQuery}"`;

    },

  },

  methods: {

    show() {

      this.visible = true;

    },

    reset() {

      this.form = { name: '', projectId: null };
      this.loading = false;
      this.creatingProject = false;
      this.projectFilterQuery = '';
      if (this.$refs.form)
        this.$refs.form.resetFields();

    },

    filterProjects(query) {

      this.projectFilterQuery = query;

    },

    onProjectChange(val) {

      if (!val) return;

      if (val === '__create__') {

        const name = this.projectFilterQuery;
        this.form.projectId = null;
        this.projectFilterQuery = '';
        this.createProject(name);

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
        this.form.projectId = synced ? String(synced.id) : null;

        if (!this.form.projectId)
          this.$message({ type: 'error', message: this.$t('Project was created but could not be selected') });

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

        const tasks = await this.$ipc.request('tasks/sync', {});
        const totalTime = await this.$ipc.request('time/total', {});
        this.$store.dispatch('totalTimeSync', totalTime.body);
        this.$store.dispatch('syncTasks', tasks.body);

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
