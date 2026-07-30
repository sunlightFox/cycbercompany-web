import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

const resources = {
  zh: {
    translation: {
      appName: 'Spring Agent Studio',
      workspace: '工作台',
      newTask: '新建任务',
      search: '搜索',
      history: '会话历史',
      manage: '管理',
      settings: '设置',
      digitalEmployee: '数字员工',
      online: '在线',
      connected: '已连接',
      emptyTitle: '今天让数字员工替你完成一件事',
      emptyHint: '描述目标、背景和期望结果，执行过程会在回答中保持透明。',
      placeholder: '输入任务，按 Enter 发送，Shift + Enter 换行',
      chooseCapability: '添加能力',
      attach: '添加文件',
      stop: '停止',
      send: '发送',
      running: '正在执行',
      completed: '已完成',
      viewSources: '查看引用',
      sources: '引用来源',
      sourceEmpty: '这条回答没有引用外部资料。',
      execution: '执行过程',
      stepCount: '个步骤',
      seconds: '秒',
      noHistory: '还没有其他会话',
      backendOffline: '后端未连接，当前使用演示数据',
      backendOnline: '后端已连接',
      configuration: '配置中心',
      agents: '数字员工',
      skills: 'Skills',
      mcp: 'MCP',
      knowledge: '知识库',
      models: '模型',
      nodes: '节点',
      close: '关闭',
      save: '保存',
      language: '语言',
      theme: '主题',
      light: '浅色',
      dark: '深色',
      chinese: '中文',
      english: 'English',
      copied: '已复制',
      copy: '复制',
      retry: '重试',
      more: '更多',
      manageHint: '集中管理数字员工与外部能力。',
      executeEmployee: '执行数字员工',
      organizeAnswer: '整理回答',
      startCoordinator: '启动本地协调器',
      suggestion1: '整理一份项目启动清单',
      suggestion2: '分析这段需求并给出执行方案',
      suggestion3: '搜索今天值得关注的 AI 动态',
      selectEmployeeHint: '选择当前工作台使用的数字员工。',
      add: '新增',
      default: '默认',
      disabled: '已停用',
      comingSoon: '配置页面将在后续版本接入真实接口。',
    },
  },
  en: {
    translation: {
      appName: 'Spring Agent Studio', workspace: 'Workspace', newTask: 'New task', search: 'Search', history: 'History', manage: 'Manage', settings: 'Settings', digitalEmployee: 'Digital employee', online: 'Online', connected: 'Connected', emptyTitle: 'Let your digital employee handle one thing today', emptyHint: 'Describe the goal, context, and expected result. The execution stays transparent in the answer.', placeholder: 'Describe a task. Enter to send, Shift + Enter for a new line', chooseCapability: 'Add capability', attach: 'Attach file', stop: 'Stop', send: 'Send', running: 'Running', completed: 'Completed', viewSources: 'View citations', sources: 'Sources', sourceEmpty: 'This answer has no external citations.', execution: 'Execution', stepCount: 'steps', seconds: 'sec', noHistory: 'No other conversations yet', backendOffline: 'Backend offline, using demo data', backendOnline: 'Backend connected', configuration: 'Configuration', agents: 'Digital employees', skills: 'Skills', mcp: 'MCP', knowledge: 'Knowledge', models: 'Models', nodes: 'Nodes', close: 'Close', save: 'Save', language: 'Language', theme: 'Theme', light: 'Light', dark: 'Dark', chinese: '中文', english: 'English', copied: 'Copied', copy: 'Copy', retry: 'Retry', more: 'More', manageHint: 'Manage digital employees and external capabilities.', executeEmployee: 'Run digital employee', organizeAnswer: 'Compose answer', startCoordinator: 'Start local coordinator', suggestion1: 'Create a project kickoff checklist', suggestion2: 'Analyze this requirement and propose an execution plan', suggestion3: 'Search today\'s AI developments', selectEmployeeHint: 'Choose the digital employee for this workspace.', add: 'Add', default: 'Default', disabled: 'Disabled', comingSoon: 'Configuration screens will connect to live APIs in a later version.',
    },
  },
} as const

const storedLanguage = localStorage.getItem('studio-language') ?? 'zh'

void i18n.use(initReactI18next).init({
  resources,
  lng: storedLanguage,
  fallbackLng: 'zh',
  interpolation: { escapeValue: false },
})

i18n.on('languageChanged', (language) => localStorage.setItem('studio-language', language))

export default i18n
