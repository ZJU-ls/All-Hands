import "@testing-library/jest-dom/vitest";

// Node 25 ships a built-in localStorage API that, when the runtime flag is
// unset, gets injected as an empty, prototype-less object — shadowing jsdom's
// real Storage. That makes `window.localStorage.getItem/setItem/clear` all
// undefined and breaks any component that reads it. We install a plain Map-
// backed Storage shim before each test suite so behavior matches a browser.
function installLocalStorageShim() {
  const backing = new Map<string, string>();
  const shim: Storage = {
    get length() {
      return backing.size;
    },
    key(index: number) {
      return Array.from(backing.keys())[index] ?? null;
    },
    getItem(key: string) {
      return backing.has(key) ? (backing.get(key) as string) : null;
    },
    setItem(key: string, value: string) {
      backing.set(key, String(value));
    },
    removeItem(key: string) {
      backing.delete(key);
    },
    clear() {
      backing.clear();
    },
  };
  // jsdom exposes window + global — overwrite both so every read path lands
  // on the shim.
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: shim,
  });
  if (typeof window !== "undefined") {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: shim,
    });
  }
}

installLocalStorageShim();
