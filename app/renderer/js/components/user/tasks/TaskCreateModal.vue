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
          allow-create
          :default-first-option="false"
          :loading="creatingProject"
          :disabled="creatingProject"
          style="width: 100%"
          @change="onProjectChange"
        >
          <el-option
            v-for="project in internalProjects"
            :key="project.id"
            :label="project.name"
            :value="String(project.id)"
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

  methods: {

    show() {

      this.visible = true;

    },

    reset() {

      this.form = { name: '', projectId: null };
      this.loading = false;
      this.creatingProject = false;
      if (this.$refs.form)
        this.$refs.form.resetFields();

    },

    onProjectChange(val) {

      if (!val) return;

      const isExisting = this.internalProjects.some(p => String(p.id) === val);
      if (!isExisting) {

        const name = val;
        this.form.projectId = null;
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

        const projectsRes = await this.$ipc.request('projects/sync', {});
        this.$store.dispatch('syncProjects', projectsRes.body);

        this.form.projectId = String(result.body.project.id);

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
