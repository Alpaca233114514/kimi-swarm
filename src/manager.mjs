import { resolve } from 'node:path';
import { manageInstallation } from './lifecycle.mjs';

try {
  const [root, action] = process.argv.slice(2);
  if (!root || !action) throw new Error('Use kimi swarm status|enable|disable|uninstall.');
  console.log(JSON.stringify(await manageInstallation(resolve(root), action), null, 2));
} catch (error) {
  console.error(`kimi-swarm: ${error.message}`);
  process.exitCode = 1;
}
