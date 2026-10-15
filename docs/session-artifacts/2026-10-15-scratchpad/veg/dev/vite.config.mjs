import { defineConfig } from '/home/user/Experiment-3/node_modules/vite/dist/node/index.js';

const WT = '/home/user/Experiment-3/.claude/worktrees/wf_1ec31848-637-3';
export default defineConfig({
  root: '/tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/veg/dev',
  base: './',
  publicDir: `${WT}/public`,
  resolve: {
    alias: [
      { find: /^three$/, replacement: `${WT}/node_modules/three/build/three.module.js` },
      { find: /^three\/addons\/(.*)$/, replacement: `${WT}/node_modules/three/examples/jsm/$1` },
      { find: '@src', replacement: `${WT}/src` },
    ],
  },
  define: { __APEX_SOURCE_FINGERPRINT__: '"dev"', __APEX_SOURCE_COMMIT__: 'null' },
  server: { host: '127.0.0.1', fs: { allow: ['/'] } },
  logLevel: 'warn',
});
