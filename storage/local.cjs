const DEFAULT_PREFIX = 'tarelka:v1:';

function createStorage(adapter, prefix = DEFAULT_PREFIX) {
  const key = (name) => `${prefix}${name}`;
  return {
    load(name, fallback = null) {
      try {
        const raw = adapter.getItem(key(name));
        return raw == null ? fallback : JSON.parse(raw);
      } catch {
        return fallback;
      }
    },
    save(name, value) {
      adapter.setItem(key(name), JSON.stringify(value));
    },
    remove(name) {
      adapter.removeItem(key(name));
    }
  };
}

module.exports = { DEFAULT_PREFIX, createStorage };
