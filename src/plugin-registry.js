const { PluginValidationError } = require('./errors');

function assertValidPlugin(plugin) {
  if (!plugin || typeof plugin !== 'object') {
    throw new PluginValidationError('Plugins must be objects.');
  }

  if (!plugin.name || typeof plugin.name !== 'string') {
    throw new PluginValidationError(
      'Plugins must define a non-empty `name` string.'
    );
  }

  if (typeof plugin.send !== 'function') {
    throw new PluginValidationError(
      `Plugin "${plugin.name}" must implement a \`send\` function.`
    );
  }

  if (plugin.open && typeof plugin.open !== 'function') {
    throw new PluginValidationError(
      `Plugin "${plugin.name}" has an invalid \`open\` hook. Expected a function.`
    );
  }

  if (plugin.close && typeof plugin.close !== 'function') {
    throw new PluginValidationError(
      `Plugin "${plugin.name}" has an invalid \`close\` hook. Expected a function.`
    );
  }

  return plugin;
}

function definePlugin(plugin) {
  return assertValidPlugin(plugin);
}

class PluginRegistry {
  constructor(plugins = []) {
    this.plugins = new Map();

    for (const plugin of plugins) {
      this.register(plugin);
    }
  }

  register(plugin) {
    const validatedPlugin = assertValidPlugin(plugin);
    this.plugins.set(validatedPlugin.name, validatedPlugin);
    return this;
  }

  has(name) {
    return this.plugins.has(name);
  }

  get(name) {
    return this.plugins.get(name);
  }

  resolve(pluginOrName) {
    if (typeof pluginOrName === 'string') {
      const plugin = this.plugins.get(pluginOrName);

      if (!plugin) {
        throw new PluginValidationError(
          `No plugin named "${pluginOrName}" has been registered.`
        );
      }

      return plugin;
    }

    return assertValidPlugin(pluginOrName);
  }

  list() {
    return Array.from(this.plugins.keys()).sort();
  }
}

module.exports = {
  assertValidPlugin,
  definePlugin,
  PluginRegistry,
};
