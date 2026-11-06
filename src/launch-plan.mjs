export function launchPlan(active, input, node = process.execPath) {
  let args = [...input];
  const dedicated = args[0] === '--kimi-swarm-entry';
  if (dedicated) args.shift();
  const commands = ['status', 'enable', 'disable', 'uninstall', 'repair'];
  const action = dedicated && args.length === 1 && commands.includes(args[0]) ? args[0]
    : args.length === 2 && args[0] === 'swarm' && commands.includes(args[1]) ? args[1] : null;
  if (action) {
    if (!active.managerPath) throw new Error('Reinstall kimi-swarm to add management commands.');
    return { manager: true, file: node, args: [active.managerPath], action };
  }
  if (active.activation === 'inactive') {
    if (!active.originalCommand) throw new Error('Original CLI path is unavailable. Run the original kimi.exe directly.');
    return { file: active.originalCommand, args };
  }
  return { file: node, args: [active.main, ...args] };
}
