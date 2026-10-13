const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const FakeWTAPI = require("./fake-wtapi");

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
  const offscreenListeners = [];
  const reconnectTimers = new Map();
  let nextTimerId = 0;
  let offscreenDocumentId = 0;
  const storageListeners = [];
  const requestedOrigins = [];
  const meetTab = { id: 1, mutedInfo: { muted: false } };
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
    sendMessage: async message => {
      let response;
      offscreenListeners.forEach(listener => listener(message, { id: "bridge" }, value => {
        response = value;
      }));
      return response;
    },
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
  class CentralinoWTAPI extends FakeWTAPI {
    static ajax = { settings: {} };
    constructor(interno, password, url) {
      super();
      this.credentials = { interno, password, url };
      clients.push(this);
    }
    connect() { this.hasStarted = true; }
    emit(event, call) {
      if (event === "disconnected") {
        this.calls.forEach(call => this.listeners.call_terminated(call));
        this.calls = [];
      }
      this.listeners[event](call);
    }
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
        loadOffscreenDocument();
      },
      closeDocument: async () => {
        offscreenDocumentId += 1;
        contexts.length = 0;
        offscreenListeners.length = 0;
        reconnectTimers.clear();
      }
    },
    tabs: {
      query: async () => [structuredClone(meetTab)],
      update: async (id, { muted }) => { meetTab.mutedInfo.muted = muted; },
      sendMessage: async () => {},
      onRemoved: { addListener() {} }
    }
  };
  function loadOffscreenDocument() {
    const documentId = ++offscreenDocumentId;
    offscreenListeners.length = 0;
    reconnectTimers.clear();
    vm.runInNewContext(readSource("offscreen.js"), {
      console, WTAPI: CentralinoWTAPI, queueMicrotask,
      setTimeout: callback => {
        const timerId = ++nextTimerId;
        reconnectTimers.set(timerId, callback);
        return timerId;
      },
      clearTimeout: timerId => reconnectTimers.delete(timerId),
      location: { reload: loadOffscreenDocument },
      chrome: { runtime: {
        id: "bridge",
        onMessage: { addListener: listener => offscreenListeners.push(listener) },
        // Closed Chrome documents cannot resume pending requests.
        sendMessage: message => sendMessage(message, getURL("src/offscreen.html")).then(response =>
          documentId === offscreenDocumentId ? response : new Promise(() => {}))
      } }
    });
  }
  function startWorker() {
    listeners.length = 0;
    startupListeners.length = 0;
    installedListeners.length = 0;
    const worker = vm.createContext({ chrome, console, URL, crypto });
    worker.importScripts = (...files) => files.forEach(file =>
      vm.runInContext(readSource(file), worker));
    vm.runInContext(readSource("background.js"), worker);
  }
  startWorker();

  return {
    badge, notifications, logs, clients, local, session, startupListeners, installedListeners,
    requestedOrigins, meetTab,
    stopWorker() { listeners.length = 0; },
    stopOffscreenMessages() { offscreenListeners.length = 0; },
    closeOffscreen: () => chrome.offscreen.closeDocument(),
    restartWorker: startWorker,
    restartChrome() {
      contexts.length = 0;
      offscreenListeners.length = 0;
      reconnectTimers.clear();
      Object.keys(session).forEach(key => delete session[key]);
      startWorker();
      startupListeners.forEach(listener => listener());
    },
    retryConnection() {
      const timers = [...reconnectTimers.values()];
      reconnectTimers.clear();
      timers.forEach(callback => callback());
    },
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

test("avvio di Chrome e installazione collegano il Centralino senza una scheda Collaboration", async () => {
  const bridge = createCentralinoHarness(credentials);
  await flush();
  assert.equal(bridge.clients.length, 1);
  assert.deepEqual(bridge.clients[0].credentials, credentials);
  assert.equal(bridge.clients[0].hasStarted, true);
  for (const listener of bridge.startupListeners) listener();
  for (const listener of bridge.installedListeners) listener({ reason: "install" });
  await flush();
  assert.equal(bridge.clients.length, 1);

  bridge.restartChrome();
  await flush();
  const client = bridge.clients.at(-1);
  assert.equal(bridge.clients.length, 2);
  assert.deepEqual(client.credentials, credentials);
  assert.equal(client.hasStarted, true);
  client.emit("connected");
  client.receiveCallsState([{
    getChannel: () => "SIP/123-riavvio", getState: () => "hold", getDirection: () => "outgoing"
  }]);
  await flush();
  assert.equal(bridge.badge.text, "");
  assert.equal(bridge.meetTab.mutedInfo.muted, true);
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

test("gli eventi di Chiamata Wildix finiscono nei log senza includere la password", async () => {
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

test("eventi Occupato/Libero di un collegamento sostituito non comandano Meet", async () => {
  const bridge = createCentralinoHarness(credentials);
  const options = bridge.openOptions();
  await flush();
  const oldClient = bridge.clients[0];
  oldClient.emit("connected");
  await flush();
  options.elements.password.value = "password-sostituita";
  await options.save();
  await flush();
  const client = bridge.clients[1];
  client.emit("connected");
  await flush();
  const call = {
    getChannel: () => "SIP/123-001", getState: () => "ring", getDirection: () => "incoming"
  };
  oldClient.receiveCallsState();
  client.receiveCallsState();
  oldClient.calls = [call];
  oldClient.emit("call_added", call);
  await flush();
  assert.equal(bridge.meetTab.mutedInfo.muted, false);
  client.calls = [call];
  client.emit("call_added", call);
  await flush();
  assert.equal(bridge.meetTab.mutedInfo.muted, true);
  oldClient.emit("call_terminated", call);
  oldClient.calls = [];
  await flush();
  assert.equal(bridge.meetTab.mutedInfo.muted, true);
});

test("le terminazioni sintetiche della WTAPI allo scollegamento non riaprono Meet", async () => {
  const bridge = createCentralinoHarness(credentials);
  await flush();
  const client = bridge.clients[0];
  client.emit("connected");
  client.receiveCallsState();
  const call = {
    getChannel: () => "SIP/123-001", getState: () => "up", getDirection: () => "incoming"
  };
  client.calls = [call];
  client.emit("call_added", call);
  await flush();
  assert.equal(bridge.meetTab.mutedInfo.muted, true);
  client.emit("disconnected");
  await flush();
  assert.equal(bridge.badge.text, "!");
  assert.equal(bridge.meetTab.mutedInfo.muted, true);
});

test("la riconnessione attende lo stato del Centralino prima di riaprire Meet", async () => {
  const bridge = createCentralinoHarness(credentials);
  await flush();
  const client = bridge.clients[0];
  const call = {
    getChannel: () => "SIP/123-001", getState: () => "up", getDirection: () => "incoming"
  };
  client.emit("connected");
  client.receiveCallsState([call]);
  await flush();
  assert.equal(bridge.meetTab.mutedInfo.muted, true);

  client.emit("disconnected");
  await flush();
  assert.equal(bridge.meetTab.mutedInfo.muted, true);
  client.emit("connected");
  await flush();
  assert.equal(bridge.meetTab.mutedInfo.muted, true);
  client.receiveCallsState([call]);
  await flush();
  assert.equal(bridge.meetTab.mutedInfo.muted, true);
  bridge.retryConnection();
  await flush();
  assert.equal(bridge.clients.length, 1);
});

test("ritenti automatici senza notifiche ripetute riallineano a Libero una Chiamata Wildix finita offline", async () => {
  const bridge = createCentralinoHarness(credentials);
  await flush();
  const client = bridge.clients[0];
  const call = {
    getChannel: () => "SIP/123-001", getState: () => "up", getDirection: () => "incoming"
  };
  client.emit("connected");
  client.receiveCallsState([call]);
  await flush();
  client.emit("disconnected");
  client.emit("disconnected");
  await flush();
  assert.equal(bridge.badge.text, "!");
  assert.equal(bridge.notifications.length, 2);
  assert.equal(bridge.meetTab.mutedInfo.muted, true);

  bridge.retryConnection();
  await flush();
  assert.equal(bridge.clients.at(-1).hasStarted, true);
  assert.equal(bridge.clients.length, 2);
  bridge.clients.at(-1).emit("disconnected");
  await flush();
  bridge.retryConnection();
  await flush();
  assert.equal(bridge.clients.length, 3);
  assert.equal(bridge.notifications.length, 2);
  assert.equal(bridge.meetTab.mutedInfo.muted, true);

  const reconnectedClient = bridge.clients.at(-1);
  reconnectedClient.emit("connected");
  await flush();
  assert.equal(bridge.meetTab.mutedInfo.muted, true);
  reconnectedClient.receiveCallsState([]);
  await flush();
  assert.equal(bridge.badge.text, "");
  assert.equal(bridge.notifications.length, 3);
  assert.equal(bridge.meetTab.mutedInfo.muted, false);
});

test("il service worker riavviato si riallinea al documento offscreen senza notifiche spurie", async () => {
  const bridge = createCentralinoHarness(credentials);
  await flush();
  const client = bridge.clients[0];
  const call = {
    getChannel: () => "SIP/123-001", getState: () => "up", getDirection: () => "incoming"
  };
  client.emit("connected");
  client.receiveCallsState([call]);
  await flush();
  bridge.stopWorker();
  client.calls = [];
  client.emit("call_terminated", call);
  await flush();
  assert.equal(bridge.meetTab.mutedInfo.muted, true);

  bridge.restartWorker();
  await flush();
  assert.equal(bridge.clients.length, 1);
  assert.equal(bridge.badge.text, "");
  assert.equal(bridge.meetTab.mutedInfo.muted, false);
  assert.equal(bridge.notifications.length, 1);
});

test("senza documento offscreen il worker riavviato ricollega il Centralino e ripristina Meet", async () => {
  const bridge = createCentralinoHarness(credentials);
  await flush();
  const call = {
    getChannel: () => "SIP/123-001", getState: () => "up", getDirection: () => "incoming"
  };
  bridge.clients[0].emit("connected");
  bridge.clients[0].receiveCallsState([call]);
  await flush();
  await bridge.closeOffscreen();
  bridge.restartWorker();
  await flush();
  const client = bridge.clients.at(-1);
  assert.equal(client.hasStarted, true);
  assert.equal(bridge.badge.text, "!");
  assert.equal(bridge.meetTab.mutedInfo.muted, true);
  client.emit("connected");
  client.receiveCallsState([]);
  await flush();
  assert.equal(bridge.badge.text, "");
  assert.equal(bridge.meetTab.mutedInfo.muted, false);
});

test("un documento offscreen senza risposta viene sostituito dopo il riavvio del worker", async () => {
  const bridge = createCentralinoHarness(credentials);
  await flush();
  bridge.stopOffscreenMessages();
  bridge.restartWorker();
  await flush();
  assert.equal(bridge.clients.length, 2);
  assert.equal(bridge.clients.at(-1).hasStarted, true);
});

test("messaggi Occupato/Libero malformati dal documento offscreen non comandano Meet", async () => {
  const bridge = createCentralinoHarness(credentials);
  await flush();
  for (const invalidState of [
    { occupato: "true", calls: [] }, { occupato: true }, { occupato: true, calls: {} }
  ]) {
    await bridge.sendMessage({
      type: "CENTRALINO_STATE_CHANGED", connectionId: bridge.session.centralinoConnectionId,
      ...invalidState
    }, "src/offscreen.html");
  }
  await flush();
  assert.equal(bridge.meetTab.mutedInfo.muted, false);
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
