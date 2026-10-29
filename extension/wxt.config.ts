import { defineConfig } from 'wxt';

// See https://wxt.dev/api/reference/wxt/interfaces/inlineconfig.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Forage',
    description: 'Save words in context while you read.',
    permissions: ['storage', 'contextMenus', 'activeTab', 'scripting'],
    commands: {
      'save-word': {
        suggested_key: { default: 'Alt+Shift+S' },
        description: 'Save the selected word to Forage',
      },
    },
  },
});
