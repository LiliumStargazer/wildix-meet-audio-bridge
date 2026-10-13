const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const readSource = file =>
  fs.readFileSync(path.join(__dirname, "..", "src", file), "utf8");

const flush = async () => {
  for (let turn = 0; turn < 10; turn += 1) {
    await new Promise(resolve => setImmediate(resolve));
  }
};

function createCentralinoHarness(settings = null) {
  const local = { centralinoSettings: settings };
  const session = {};
  const notifications = [];
  const logs = [];
  const clients = [];
  const listeners = [];
  const startupListeners = [];
  const installedListeners = [];
  const badge = {};
  const contexts = [];
  const storageListeners = [];
  const requestedOrigins = [];
  const meetChanges = [];
  let hasHostPermission = true;
  let grantsHostPermission = true;
  let notificationsFail = false;
  let localAccessLevel;
  const getURL = file => `chrome-extension://bridge/${file}`;
  const storageArea = (store, areaName) => ({
    get: async keys => structuredClone(typeof keys === "string"
      ? { [keys]: store[keys] }
      : { ...keys, ...store }),
    set: async values => {
      const changes = Object.fromEntries(Object.entries(values).map(([key, newValue]) =>
        [key, { oldValue: store[key], newValue: structuredClone(newValue) }]));
      Object.assign(store, structuredClone(values));
      storageListeners.forEach(listener => listener(changes, areaName));
    },
    setAccessLevel: async ({ accessLevel }) => { localAccessLevel = accessLevel; }
  });
  const runtime = {
    id: "bridge",
    getURL,
    getManifest: () => ({ version: "test", content_scripts: [] }),
    getContexts: async () => structuredClone(contexts),
    onMessage: { addListener: listener => listeners.push(listener) },
    onStartup: { addListener: listener => startupListeners.push(listener) },
    onInstalled: { addListener: listener => installedListeners.push(listener) }
  };
  const sendMessage = (message, url) => new Promise((resolve, reject) => {
    let hasResponse = false;
    for (const listener of listeners) {
      try {
        const tab = url === getURL("src/options.html") ? { id: 2 } : undefined;
        if (listener(message, { id: "bridge", url, tab }, resolve) === true) {
          hasResponse = true;
        }
      } catch (error) {
        reject(error);
        return;
      }
    }
    if (!hasResponse) resolve();
  });
  class FakeWTAPI {
    static ajax = { settings: {} };
    constructor(interno, password, url) {
      this.credentials = { interno, password, url };
      this.listeners = {};
      this.telephony = { on: (event, listener) => { this.listeners[event] = listener; } };
      clients.push(this);
    }
    on(event, listener) { this.listeners[event] = listener; }
    connect() { this.hasStarted = true; }
    emit(event, call) { this.listeners[event](call); }
  }
  const console = Object.fromEntries(["log", "warn", "error"].map(level =>
    [level, (...args) => logs.push(args)]));
  const chrome = {
    runtime,
    storage: {
      local: storageArea(local, "local"), session: storageArea(session, "session"),
      onChanged: { addListener: listener => storageListeners.push(listener) }
    },
    permissions: {
      contains: async () => hasHostPermission,
      request: async ({ origins }) => {
        requestedOrigins.push(...origins);
        return grantsHostPermission;
      }
    },
    action: {
      setBadgeText: async ({ text }) => { badge.text = text; },
      setBadgeBackgroundColor: async ({ color }) => { badge.color = color; }
    },
    notifications: { create: async options => {
      if (notificationsFail) throw new Error("Notifiche non disponibili");
      notifications.push(options);
    } },
    offscreen: {
      createDocument: async () => {
        contexts.push({ documentUrl: getURL("src/offscreen.html") });
        vm.runInNewContext(readSource("offscreen.js"), {
          console, WTAPI: FakeWTAPI,
          chrome: { runtime: {
            sendMessage: message => sendMessage(message, getURL("src/offscreen.html"))
          } }
        });
      },
      closeDocument: async () => { contexts.length = 0; }
    },
    tabs: {
      query: async () => [{ id: 1, mutedInfo: { muted: false } }],
      update: async (...args) => { meetChanges.push(args); },
      sendMessage: async (...args) => { meetChanges.push(args); },
      onRemoved: { addListener() {} }
    }
  };
  const worker = vm.createContext({ chrome, console, URL, crypto });
  worker.importScripts = (...files) => files.forEach(file =>
    vm.runInContext(readSource(file), worker));
  vm.runInContext(readSource("background.js"), worker);

  return {
    badge, notifications, logs, clients, local, session, startupListeners, installedListeners,
    requestedOrigins, meetChanges,
    denyHostPermission() { grantsHostPermission = false; },
    revokeHostPermission() { hasHostPermission = false; },
    failNotifications() { notificationsFail = true; },
    get localAccessLevel() { return localAccessLevel; },
    openOptions() {
      const elements = Object.fromEntries([
        "centralino-form", "interno", "password", "url", "save", "save-status", "connection-status"
      ].map(id => [id, { value: "", textContent: "", addEventListener(event, listener) {
        this[event] = listener;
      } }]));
      const page = vm.createContext({
        console, URL, document: { getElementById: id => elements[id] },
        chrome: { ...chrome, runtime: { ...runtime,
          sendMessage: message => sendMessage(message, getURL("src/options.html"))
        } }
      });
      vm.runInContext(readSource("centralino-settings.js"), page);
      vm.runInContext(readSource("options.js"), page);
      return {
        elements,
        save: () => elements["centralino-form"].submit({ preventDefault() {} })
      };
    },
    sendMessage: (message, file = "src/options.html") => sendMessage(message, getURL(file))
  };
}

const credentials = {
  interno: "123",
  password: "password-di-test",
  url: "https://automaticmachines.wildixin.com"
};

test("credenziali assenti: badge rosso, nessun login e nessuna notifica", async () => {
  const bridge = createCentralinoHarness();
  await flush();
  assert.equal(bridge.badge.text, "!");
  assert.equal(bridge.badge.color, "#d93025");
  assert.equal(bridge.clients.length, 0);
  assert.deepEqual(bridge.notifications, []);
});

test("avvio e installazione collegano il Centralino senza una scheda Collaboration", async () => {
  const bridge = createCentralinoHarness(credentials);
  await flush();
  assert.equal(bridge.clients.length, 1);
  assert.deepEqual(bridge.clients[0].credentials, credentials);
  assert.equal(bridge.clients[0].hasStarted, true);
  for (const listener of bridge.startupListeners) listener();
  for (const listener of bridge.installedListeners) listener({ reason: "install" });
  await flush();
  assert.equal(bridge.clients.length, 1);
});

test("badge e notifiche seguono solo i cambi del collegamento, non i tentativi", async () => {
  const bridge = createCentralinoHarness(credentials);
  await flush();
  const client = bridge.clients[0];
  client.emit("disconnected");
  client.emit("disconnected");
  await flush();
  assert.equal(bridge.badge.text, "!");
  assert.equal(bridge.notifications.length, 0);

  client.emit("connected");
  client.emit("connected");
  await flush();
  assert.equal(bridge.badge.text, "");
  assert.equal(bridge.session.centralinoConnected, true);
  assert.equal(bridge.notifications.length, 1);

  client.emit("disconnected");
  client.emit("disconnected");
  await flush();
  assert.equal(bridge.badge.text, "!");
  assert.equal(bridge.session.centralinoConnected, false);
  assert.equal(bridge.notifications.length, 2);

  client.emit("connected");
  await flush();
  assert.equal(bridge.badge.text, "");
  assert.equal(bridge.notifications.length, 3);
  assert.match(bridge.logs.flat().join(" "), /Centralino collegato/);
  assert.match(bridge.logs.flat().join(" "), /Centralino scollegato/);
});

test("le opzioni precompilano il Centralino, salvano le credenziali e mostrano il collegamento", async () => {
  const bridge = createCentralinoHarness();
  const options = bridge.openOptions();
  await flush();
  assert.equal(options.elements.url.value, "https://automaticmachines.wildixin.com");
  assert.equal(options.elements["connection-status"].textContent, "Scollegato");
  options.elements.interno.value = " 456 ";
  options.elements.password.value = "nuova-password";
  options.elements.url.value = "https://altro.wildixin.com/";
  await options.save();
  await flush();
  assert.deepEqual(bridge.requestedOrigins, ["https://altro.wildixin.com/*"]);
  assert.deepEqual(bridge.local.centralinoSettings, {
    interno: "456", password: "nuova-password", url: "https://altro.wildixin.com"
  });
  assert.equal(bridge.clients.length, 1);
  bridge.clients[0].emit("connected");
  await flush();
  assert.equal(options.elements["connection-status"].textContent, "Collegato");
  bridge.clients[0].emit("disconnected");
  await flush();
  assert.equal(options.elements["connection-status"].textContent, "Scollegato");
});

test("le opzioni rifiutano HTTP e il permesso negato senza cambiare le credenziali", async () => {
  const bridge = createCentralinoHarness(credentials);
  const options = bridge.openOptions();
  await flush();
  options.elements.url.value = "http://altro.wildixin.com";
  await options.save();
  assert.match(options.elements["save-status"].textContent, /HTTPS/);
  assert.deepEqual(bridge.requestedOrigins, []);
  options.elements.url.value = "https://altro.wildixin.com";
  bridge.denyHostPermission();
  await options.save();
  assert.match(options.elements["save-status"].textContent, /negato/);
  assert.deepEqual(bridge.local.centralinoSettings, credentials);
  assert.equal(bridge.clients.length, 1);
});

test("gli eventi di Chiamata Wildix finiscono nei log, senza comandare Meet", async () => {
  const bridge = createCentralinoHarness(credentials);
  await flush();
  const client = bridge.clients[0];
  const call = {
    getChannel: () => "SIP/123-001",
    getState: () => "ring",
    getDirection: () => "incoming"
  };
  for (const event of ["call_added", "call_updated", "call_terminated"]) {
    client.emit(event, call);
    assert.ok(bridge.logs.some(entry => entry.includes(event)));
  }
  await flush();
  assert.deepEqual(bridge.meetChanges, []);
  assert.ok(!JSON.stringify(bridge.logs).includes(credentials.password));
});

test("salvare nuove opzioni sostituisce il collegamento e ignora gli eventi del precedente", async () => {
  const bridge = createCentralinoHarness(credentials);
  const options = bridge.openOptions();
  await flush();
  const oldClient = bridge.clients[0];
  oldClient.emit("connected");
  await flush();
  options.elements.password.value = "password-sostituita";
  await options.save();
  await flush();
  assert.equal(bridge.clients.length, 2);
  assert.equal(bridge.clients[1].credentials.password, "password-sostituita");
  assert.equal(bridge.badge.text, "!");
  oldClient.emit("connected");
  await flush();
  assert.equal(bridge.badge.text, "!");
  bridge.clients[1].emit("connected");
  await flush();
  assert.equal(bridge.badge.text, "");
  const reopenedOptions = bridge.openOptions();
  await flush();
  assert.equal(reopenedOptions.elements.password.value, "password-sostituita");
  assert.equal(reopenedOptions.elements["connection-status"].textContent, "Collegato");
});

test("credenziali incomplete o indirizzi non sicuri non aprono un collegamento", async () => {
  for (const settings of [
    { ...credentials, interno: " " },
    { ...credentials, password: "" },
    { ...credentials, url: "http://automaticmachines.wildixin.com" },
    { ...credentials, url: "https://login:password@example.com" },
    { ...credentials, url: "https://example.com/percorso" }
  ]) {
    const bridge = createCentralinoHarness(settings);
    await flush();
    assert.equal(bridge.badge.text, "!");
    assert.equal(bridge.clients.length, 0);
    assert.deepEqual(bridge.notifications, []);
  }
});

test("senza permesso host il Centralino resta scollegato e la password non è accessibile ai content script", async () => {
  const bridge = createCentralinoHarness(credentials);
  bridge.revokeHostPermission();
  await flush();
  assert.equal(bridge.badge.text, "!");
  assert.equal(bridge.clients.length, 0);
  assert.equal(bridge.localAccessLevel, "TRUSTED_CONTEXTS");
  assert.equal(await bridge.sendMessage({ type: "CENTRALINO_GET_SETTINGS" }, "src/wildix.js"), undefined);
  await bridge.sendMessage({
    type: "CENTRALINO_CONNECTION_CHANGED", connected: true,
    connectionId: bridge.session.centralinoConnectionId
  }, "src/wildix.js");
  await flush();
  assert.equal(bridge.badge.text, "!");
});

test("una notifica non disponibile non fa apparire scollegato un Centralino collegato", async () => {
  const bridge = createCentralinoHarness(credentials);
  bridge.failNotifications();
  await flush();
  bridge.clients[0].emit("connected");
  await flush();
  assert.equal(bridge.badge.text, "");
  assert.equal(bridge.session.centralinoConnected, true);
});
