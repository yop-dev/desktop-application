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
          :placeholder="$t('Select project')"
          filterable
          style="width: 100%"
        >
          <el-option
            v-for="project in internalProjects"
            :key="project.id"
            :label="project.name"
            :value="String(project.id)"
          />
        </el-select>
      </el-form-item>

      <el-form-item v-if="!showNewProject">
        <el-button
          type="text"
          size="small"
          @click="showNewProject = true"
        >
          + {{ $t('New project') }}
        </el-button>
      </el-form-item>

      <template v-if="showNewProject">

        <el-form-item :label="$t('New project name')">
          <el-input
            v-model="newProjectName"
            :placeholder="$t('Project name')"
            @keyup.enter.native="createProject"
          />
        </el-form-item>

        <el-form-item>
          <el-button
            type="primary"
            size="small"
            :loading="creatingProject"
            @click="createProject"
          >
            {{ $t('Create project') }}
          </el-button>
          <el-button
            size="small"
            @click="showNewProject = false; newProjectName = ''"
          >
            {{ $t('Cancel') }}
          </el-button>
        </el-form-item>

      </template>

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
      showNewProject: false,
      newProjectName: '',
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
      this.showNewProject = false;
      this.newProjectName = '';
      this.creatingProject = false;
      if (this.$refs.form)
        this.$refs.form.resetFields();

    },

    async createProject() {

      if (!this.newProjectName.trim())
        return;

      this.creatingProject = true;

      try {

        const result = await this.$ipc.request('projects/create', { name: this.newProjectName.trim() });

        if (result.code !== 200) {

          this.$message({ type: 'error', message: `${this.$t('Failed to create project')} (${result.code})` });
          return;

        }

        const projectsRes = await this.$ipc.request('projects/sync', {});
        this.$store.dispatch('syncProjects', projectsRes.body);

        this.form.projectId = String(result.body.project.id);
        this.showNewProject = false;
        this.newProjectName = '';

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
