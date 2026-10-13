const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const FakeWTAPI = require("./fake-wtapi");

const redIconPaths = { 16: "icons/icon16-red.png", 32: "icons/icon32-red.png" };
const greenIconPaths = { 16: "icons/icon16-green.png", 32: "icons/icon32-green.png" };

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
  const icon = {};
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
  let settingsStorageFails = false;
  let offscreenCreationFails = false;
  let offscreenCreationDelay;
  let localAccessLevel;
  const getURL = file => `chrome-extension://bridge/${file}`;
  const storageArea = (store, areaName) => ({
    get: async keys => structuredClone(typeof keys === "string"
      ? { [keys]: store[keys] }
      : { ...keys, ...store }),
    set: async values => {
      if (areaName === "local" && settingsStorageFails) throw new Error("Storage non disponibile");
      const changes = Object.fromEntries(Object.entries(values).map(([key, newValue]) =>
        [key, { oldValue: store[key], newValue: structuredClone(newValue) }]));
      Object.assign(store, structuredClone(values));
      storageListeners.slice().forEach(listener => listener(changes, areaName));
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
  const sendMessage = (message, url, sender = {}) => new Promise((resolve, reject) => {
    let hasResponse = false;
    for (const listener of listeners) {
      try {
        const tab = url === getURL("src/wildix.js") ? { id: 2 } : undefined;
        if (listener(message, { id: "bridge", url, tab, ...sender }, resolve) === true) {
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
      setIcon: async ({ path: iconPaths }) => {
        const resolvedPaths = {};
        for (const [size, iconPath] of Object.entries(iconPaths)) {
          // Chrome's service-worker binding fetches paths relative to the worker URL.
          const iconUrl = new URL(iconPath, getURL("src/background.js"));
          const file = iconUrl.pathname.slice(1);
          if (!fs.existsSync(path.join(__dirname, "..", file))) {
            throw new Error(`Failed to set icon '${iconPath}': Failed to fetch`);
          }
          resolvedPaths[size] = file;
        }
        icon.path = resolvedPaths;
      },
      setBadgeText: async ({ text }) => { badge.text = text; },
      setBadgeBackgroundColor: async ({ color }) => { badge.color = color; }
    },
    notifications: { create: async options => {
      if (notificationsFail) throw new Error("Notifiche non disponibili");
      const iconUrl = new URL(options.iconUrl, getURL("src/background.js"));
      if (!fs.existsSync(path.join(__dirname, "..", iconUrl.pathname.slice(1)))) {
        throw new Error("Unable to download all specified images.");
      }
      notifications.push(options);
    } },
    offscreen: {
      createDocument: async () => {
        await offscreenCreationDelay;
        if (offscreenCreationFails) throw new Error("Offscreen non disponibile");
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
    badge, icon, notifications, logs, clients, local, session, startupListeners, installedListeners,
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
    failSettingsStorage() { settingsStorageFails = true; },
    failOffscreenCreation() { offscreenCreationFails = true; },
    delayOffscreenCreationUntil(delay) { offscreenCreationDelay = delay; },
    get localAccessLevel() { return localAccessLevel; },
    openPopup({ closeAfterSaving = false, settingsReadDelay } = {}) {
      const html = readSource("popup.html");
      const elements = {};
      const document = { getElementById: id => elements[id], activeElement: null };
      for (const [, tag, attributes] of html.matchAll(/<([a-z][\w-]*)\b([^>]*)>/gi)) {
        const id = attributes.match(/\bid="([^"]+)"/)?.[1];
        if (!id) continue;
        elements[id] = {
          tag, value: attributes.match(/\bvalue="([^"]*)"/)?.[1] ?? "", textContent: "",
          type: attributes.match(/\btype="([^"]+)"/)?.[1],
          hidden: /\bhidden\b/.test(attributes), disabled: /\bdisabled\b/.test(attributes),
          open: /\bopen\b/.test(attributes),
          addEventListener(event, listener) { this[event] = listener; },
          focus() { if (!this.disabled) document.activeElement = this; }
        };
      }
      const popupStorageListeners = [];
      let isClosed = false;
      function close() {
        isClosed = true;
        popupStorageListeners.forEach(listener => storageListeners.splice(storageListeners.indexOf(listener), 1));
        popupStorageListeners.length = 0;
      }
      // Closed Chrome popups cannot resume pending API requests.
      const receiveInPopup = promise => promise.then(response =>
        isClosed ? new Promise(() => {}) : response);
      const observeStorage = listener => {
        popupStorageListeners.push(listener);
        storageListeners.push(listener);
      };
      if (closeAfterSaving) {
        observeStorage((changes, areaName) => {
          if (areaName === "local" && changes.centralinoSettings) close();
        });
      }
      const page = vm.createContext({
        console, URL, document,
        chrome: { ...chrome, storage: { ...chrome.storage,
          local: { ...chrome.storage.local,
            get: keys => receiveInPopup(chrome.storage.local.get(keys).then(async snapshot => {
              await settingsReadDelay;
              return snapshot;
            }))
          },
          onChanged: { addListener: observeStorage }
        }, runtime: { ...runtime,
          sendMessage: message => receiveInPopup(sendMessage(message, getURL("src/popup.html")))
        } }
      });
      for (const [, script] of html.matchAll(/<script src="([^"]+)"/g)) {
        vm.runInContext(readSource(script), page);
      }
      return {
        elements, document,
        save: () => elements["centralino-form"].submit({ preventDefault() {} }),
        editCredentials() {
          if (!elements["edit-credentials"].disabled) elements["edit-credentials"].click();
        },
        toggleAdvancedSettings() {
          elements["advanced-settings"].open = !elements["advanced-settings"].open;
        },
        close
      };
    },
    sendMessage: (message, file = "src/popup.html", sender) => sendMessage(message, getURL(file), sender)
  };
}

const credentials = {
  interno: "123",
  password: "password-di-test",
  url: "https://automaticmachines.wildixin.com"
};

test("il clic sull'icona apre il popup come unica interfaccia di configurazione", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8"));
  assert.equal(manifest.action.default_popup, "src/popup.html");
  assert.equal(manifest.options_ui, undefined);
  assert.equal(manifest.options_page, undefined);
});

test("l'azione parte con l'icona rossa e dispone delle varianti PNG per la barra di Chrome", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8"));
  assert.deepEqual(manifest.action.default_icon, redIconPaths);
  for (const iconPaths of [redIconPaths, greenIconPaths]) {
    for (const [size, file] of Object.entries(iconPaths)) {
      const png = fs.readFileSync(path.join(__dirname, "..", file));
      assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      assert.equal(png.readUInt32BE(16), Number(size));
      assert.equal(png.readUInt32BE(20), Number(size));
    }
  }
});

test("il popup usa campi etichettati, comandi nativi e stato testuale e informa del salvataggio locale", () => {
  const html = readSource("popup.html");
  for (const id of ["interno", "password", "url"]) {
    assert.match(html, new RegExp(`<label for="${id}">[^<]+</label>`));
  }
  assert.match(html, /<button id="save" type="submit"[^>]*>Salva e collega<\/button>/);
  assert.match(html, /<button id="edit-credentials" type="button">Modifica credenziali<\/button>/);
  assert.match(html, /<summary>Impostazioni avanzate<\/summary>/);
  assert.match(html, /id="connection-status" role="status"/);
  assert.match(html, /id="save-status" role="status"/);
  assert.match(html, /profilo Chrome, non cifrate/);
  assert.match(html, /inviate solo al Centralino scelto/);
});

test("credenziali assenti: icona rossa, badge di avviso, nessun login e nessuna notifica", async () => {
  const bridge = createCentralinoHarness();
  await flush();
  assert.deepEqual(bridge.icon.path, redIconPaths);
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
  assert.deepEqual(bridge.icon.path, redIconPaths);
  assert.equal(bridge.badge.text, "!");
  client.emit("connected");
  client.receiveCallsState([{
    getChannel: () => "SIP/123-riavvio", getState: () => "hold", getDirection: () => "outgoing"
  }]);
  await flush();
  assert.deepEqual(bridge.icon.path, greenIconPaths);
  assert.equal(bridge.badge.text, "");
  assert.equal(bridge.meetTab.mutedInfo.muted, true);
});

test("icona, badge e notifiche seguono solo i cambi del collegamento, non i tentativi", async () => {
  const bridge = createCentralinoHarness(credentials);
  await flush();
  assert.deepEqual(bridge.icon.path, redIconPaths);
  assert.equal(bridge.badge.text, "!");
  assert.equal(bridge.notifications.length, 0);
  const client = bridge.clients[0];
  client.emit("disconnected");
  client.emit("disconnected");
  await flush();
  assert.deepEqual(bridge.icon.path, redIconPaths);
  assert.equal(bridge.badge.text, "!");
  assert.equal(bridge.notifications.length, 0);

  client.emit("connected");
  client.emit("connected");
  await flush();
  assert.deepEqual(bridge.icon.path, greenIconPaths);
  assert.equal(bridge.badge.text, "");
  assert.equal(bridge.session.centralinoConnected, true);
  assert.equal(bridge.notifications.length, 1);

  client.emit("disconnected");
  client.emit("disconnected");
  await flush();
  assert.deepEqual(bridge.icon.path, redIconPaths);
  assert.equal(bridge.badge.text, "!");
  assert.equal(bridge.session.centralinoConnected, false);
  assert.equal(bridge.notifications.length, 2);

  client.emit("connected");
  await flush();
  assert.deepEqual(bridge.icon.path, greenIconPaths);
  assert.equal(bridge.badge.text, "");
  assert.equal(bridge.notifications.length, 3);
  assert.match(bridge.logs.flat().join(" "), /Centralino collegato/);
  assert.match(bridge.logs.flat().join(" "), /Centralino scollegato/);
});

test("Occupato e Libero non cambiano l'icona verde, il badge o le notifiche del collegamento", async () => {
  const bridge = createCentralinoHarness(credentials);
  await flush();
  const client = bridge.clients[0];
  client.emit("connected");
  await flush();
  const call = {
    getChannel: () => "SIP/123-001", getState: () => "ring", getDirection: () => "incoming"
  };
  for (const calls of [[call], []]) {
    client.receiveCallsState(calls);
    await flush();
    assert.equal(bridge.meetTab.mutedInfo.muted, calls.length > 0);
    assert.deepEqual(bridge.icon.path, greenIconPaths);
    assert.equal(bridge.badge.text, "");
    assert.equal(bridge.notifications.length, 1);
  }
});

test("al primo accesso il popup mostra Interno e password mascherata con Impostazioni avanzate chiuse", async () => {
  const bridge = createCentralinoHarness();
  const popup = bridge.openPopup();
  await flush();
  assert.equal(popup.elements["centralino-form"].hidden, false);
  assert.equal(popup.elements.interno.value, "");
  assert.equal(popup.elements.password.value, "");
  assert.equal(popup.elements.password.type, "password");
  assert.equal(popup.elements.save.disabled, false);
  assert.equal(popup.elements["advanced-settings"].tag, "details");
  assert.equal(popup.elements["advanced-settings"].open, false);
  assert.equal(popup.elements.url.value, "https://automaticmachines.wildixin.com");
  assert.equal(popup.elements["connection-status"].textContent, "Scollegato");
  assert.equal(popup.elements["credentials-summary"].hidden, true);
  assert.equal(bridge.clients.length, 0);
});

test("le credenziali salvate mostrano il riepilogo, ma Collegato solo dopo la conferma del Centralino", async () => {
  const bridge = createCentralinoHarness();
  const popup = bridge.openPopup();
  await flush();
  popup.elements.interno.value = " 456 ";
  popup.elements.password.value = "nuova-password";
  popup.toggleAdvancedSettings();
  popup.elements.url.value = "https://altro.wildixin.com/";
  await popup.save();
  await flush();
  const savedCredentials = {
    interno: "456", password: "nuova-password", url: "https://altro.wildixin.com"
  };
  assert.deepEqual(bridge.requestedOrigins, ["https://altro.wildixin.com/*"]);
  assert.deepEqual(bridge.local.centralinoSettings, savedCredentials);
  assert.equal(popup.elements["save-status"].textContent, "Credenziali salvate. Collegamento al Centralino avviato.");
  assert.equal(bridge.clients.length, 1);
  assert.deepEqual(bridge.clients[0].credentials, savedCredentials);
  assert.equal(popup.elements["centralino-form"].hidden, true);
  assert.equal(popup.elements["credentials-summary"].hidden, false);
  assert.equal(popup.elements["summary-interno"].textContent, "456");
  assert.equal(popup.elements.password.value, "");
  assert.equal(popup.elements["connection-status"].textContent, "Scollegato — riconnessione automatica");
  assert.deepEqual(bridge.icon.path, redIconPaths);
  assert.equal(bridge.badge.text, "!");
  assert.equal(bridge.notifications.length, 0);
  bridge.clients[0].emit("connected");
  await flush();
  assert.equal(popup.elements["connection-status"].textContent, "Collegato");
  assert.deepEqual(bridge.icon.path, greenIconPaths);
  assert.equal(bridge.badge.text, "");
  bridge.clients[0].emit("disconnected");
  await flush();
  assert.equal(popup.elements["connection-status"].textContent, "Scollegato — riconnessione automatica");
  assert.equal(popup.elements["centralino-form"].hidden, true);
  assert.deepEqual(bridge.icon.path, redIconPaths);
  assert.equal(bridge.badge.text, "!");
});

test("chiudere il popup appena persistono le credenziali non impedisce il collegamento in background", async () => {
  const bridge = createCentralinoHarness();
  const popup = bridge.openPopup({ closeAfterSaving: true });
  await flush();
  popup.elements.interno.value = "123";
  popup.elements.password.value = credentials.password;
  popup.save();
  await flush();
  assert.deepEqual(bridge.local.centralinoSettings, credentials);
  assert.equal(bridge.clients.length, 1);
  assert.deepEqual(bridge.clients[0].credentials, credentials);
  bridge.clients[0].emit("connected");
  await flush();
  const reopenedPopup = bridge.openPopup();
  await flush();
  assert.equal(reopenedPopup.elements["centralino-form"].hidden, true);
  assert.equal(reopenedPopup.elements["connection-status"].textContent, "Collegato");
  assert.equal(bridge.clients.length, 1);
});

test("una lettura iniziale tardiva non sostituisce le credenziali aggiornate mentre il popup si riapre", async () => {
  const bridge = createCentralinoHarness(credentials);
  let finishCreatingOffscreen;
  bridge.delayOffscreenCreationUntil(new Promise(resolve => { finishCreatingOffscreen = resolve; }));
  const popup = bridge.openPopup();
  await flush();
  popup.editCredentials();
  const updatedCredentials = {
    interno: "456", password: "password-aggiornata", url: "https://nuovo.wildixin.com"
  };
  popup.elements.interno.value = updatedCredentials.interno;
  popup.elements.password.value = updatedCredentials.password;
  popup.elements.url.value = updatedCredentials.url;
  popup.save();
  await flush();
  popup.close();
  let finishReadingSettings;
  const settingsReadDelay = new Promise(resolve => { finishReadingSettings = resolve; });
  const reopenedPopup = bridge.openPopup({ settingsReadDelay });
  await flush();
  finishCreatingOffscreen();
  await flush();
  assert.equal(reopenedPopup.elements["summary-interno"].textContent, "456");
  finishReadingSettings();
  await flush();
  assert.equal(reopenedPopup.elements["summary-interno"].textContent, "456");
  reopenedPopup.editCredentials();
  assert.equal(reopenedPopup.elements.interno.value, "456");
  assert.equal(reopenedPopup.elements.password.value, "password-aggiornata");
  assert.equal(reopenedPopup.elements.url.value, "https://nuovo.wildixin.com");
  reopenedPopup.elements.interno.value = "789";
  await reopenedPopup.save();
  await flush();
  assert.deepEqual(bridge.clients.at(-1).credentials, { ...updatedCredentials, interno: "789" });
});

test("Modifica credenziali attende il salvataggio precedente prima di consentire una nuova modifica", async () => {
  const bridge = createCentralinoHarness();
  const popup = bridge.openPopup();
  await flush();
  let finishCreatingOffscreen;
  bridge.delayOffscreenCreationUntil(new Promise(resolve => { finishCreatingOffscreen = resolve; }));
  popup.elements.interno.value = "123";
  popup.elements.password.value = credentials.password;
  const pendingSave = popup.save();
  await flush();
  assert.equal(popup.elements["credentials-summary"].hidden, false);
  assert.equal(popup.elements["edit-credentials"].disabled, true);
  popup.editCredentials();
  assert.equal(popup.elements["centralino-form"].hidden, true);
  finishCreatingOffscreen();
  await pendingSave;
  await flush();
  assert.equal(popup.elements["edit-credentials"].disabled, false);
  assert.equal(popup.document.activeElement, popup.elements["edit-credentials"]);
  popup.editCredentials();
  popup.elements.password.value = "password-corretta";
  assert.equal(popup.elements["centralino-form"].hidden, false);
  await popup.save();
  await flush();
  assert.deepEqual(bridge.clients.at(-1).credentials, { ...credentials, password: "password-corretta" });
});

test("login fallito e caduta della rete mantengono il riepilogo e aggiornano lo stato alla riconnessione", async () => {
  const bridge = createCentralinoHarness();
  const popup = bridge.openPopup();
  await flush();
  popup.elements.interno.value = "123";
  popup.elements.password.value = "password-errata";
  await popup.save();
  await flush();
  bridge.clients[0].emit("disconnected");
  bridge.clients[0].emit("disconnected");
  await flush();
  assert.equal(popup.elements["centralino-form"].hidden, true);
  assert.equal(popup.elements["connection-status"].textContent, "Scollegato — riconnessione automatica");
  assert.equal(bridge.badge.text, "!");
  assert.equal(bridge.notifications.length, 0);
  popup.close();
  const reopenedPopup = bridge.openPopup();
  await flush();
  assert.equal(reopenedPopup.elements["summary-interno"].textContent, "123");
  assert.equal(reopenedPopup.elements.password.value, "");
  assert.equal(reopenedPopup.elements["centralino-form"].hidden, true);
  assert.equal(reopenedPopup.elements["connection-status"].textContent, "Scollegato — riconnessione automatica");
  bridge.retryConnection();
  await flush();
  assert.equal(bridge.clients.length, 2);
  assert.equal(bridge.notifications.length, 0);
  reopenedPopup.editCredentials();
  reopenedPopup.elements.password.value = credentials.password;
  await reopenedPopup.save();
  await flush();
  const client = bridge.clients.at(-1);
  assert.deepEqual(client.credentials, credentials);
  client.emit("connected");
  await flush();
  assert.equal(reopenedPopup.elements["connection-status"].textContent, "Collegato");
  client.emit("disconnected");
  await flush();
  assert.equal(reopenedPopup.elements["connection-status"].textContent, "Scollegato — riconnessione automatica");
  assert.equal(reopenedPopup.elements["centralino-form"].hidden, true);
  bridge.retryConnection();
  await flush();
  const reconnectedClient = bridge.clients.at(-1);
  assert.deepEqual(reconnectedClient.credentials, credentials);
  assert.equal(bridge.notifications.length, 2);
  reconnectedClient.emit("connected");
  await flush();
  assert.equal(reopenedPopup.elements["connection-status"].textContent, "Collegato");
  assert.equal(reopenedPopup.elements.password.value, "");
  assert.equal(bridge.notifications.length, 3);
});

test("dati non validi e permesso negato mostrano un errore senza sostituire la configurazione o il collegamento", async () => {
  const bridge = createCentralinoHarness(credentials);
  const popup = bridge.openPopup();
  await flush();
  bridge.clients[0].emit("connected");
  await flush();
  popup.editCredentials();
  for (const invalidSettings of [
    { ...credentials, interno: " ", error: /Interno/ },
    { ...credentials, password: "", error: /password/ },
    { ...credentials, url: "non-un-indirizzo", error: /HTTPS/ },
    { ...credentials, url: "http://altro.wildixin.com", error: /HTTPS/ },
    { ...credentials, url: "https://login:segreto@altro.wildixin.com", error: /credenziali/ },
    { ...credentials, url: "https://altro.wildixin.com/percorso", error: /percorso/ },
    { ...credentials, url: "https://altro.wildixin.com?query=1", error: /percorso/ },
    { ...credentials, url: "https://altro.wildixin.com#frammento", error: /percorso/ }
  ]) {
    popup.elements.interno.value = invalidSettings.interno;
    popup.elements.password.value = invalidSettings.password;
    popup.elements.url.value = invalidSettings.url;
    await popup.save();
    assert.match(popup.elements["save-status"].textContent, invalidSettings.error);
    assert.equal(popup.elements["save-status"].hidden, false);
    assert.equal(popup.elements["centralino-form"].hidden, false);
    assert.equal(popup.elements.save.disabled, false);
    assert.deepEqual(bridge.local.centralinoSettings, credentials);
  }
  assert.deepEqual(bridge.requestedOrigins, []);
  popup.elements.interno.value = "456";
  popup.elements.password.value = "nuova-password";
  popup.elements.url.value = "https://altro.wildixin.com";
  bridge.denyHostPermission();
  await popup.save();
  assert.match(popup.elements["save-status"].textContent, /negato/);
  assert.deepEqual(bridge.local.centralinoSettings, credentials);
  assert.equal(bridge.clients.length, 1);
  assert.equal(popup.elements["connection-status"].textContent, "Collegato");
  assert.equal(bridge.notifications.length, 1);
});

test("un errore di storage lascia in uso le credenziali e il collegamento precedenti", async () => {
  const bridge = createCentralinoHarness(credentials);
  const popup = bridge.openPopup();
  await flush();
  bridge.clients[0].emit("connected");
  await flush();
  popup.editCredentials();
  popup.elements.password.value = "nuova-password";
  bridge.failSettingsStorage();
  await popup.save();
  await flush();
  assert.match(popup.elements["save-status"].textContent, /salvare/);
  assert.equal(popup.elements["centralino-form"].hidden, false);
  assert.deepEqual(bridge.local.centralinoSettings, credentials);
  assert.equal(bridge.clients.length, 1);
  assert.equal(popup.elements["connection-status"].textContent, "Collegato");
  assert.equal(bridge.notifications.length, 1);
});

test("credenziali persistite restano nel riepilogo anche se il background non riesce ad avviare il collegamento", async () => {
  const bridge = createCentralinoHarness();
  const popup = bridge.openPopup();
  await flush();
  popup.elements.interno.value = "123";
  popup.elements.password.value = credentials.password;
  bridge.failOffscreenCreation();
  await popup.save();
  await flush();
  assert.deepEqual(bridge.local.centralinoSettings, credentials);
  assert.equal(popup.elements["credentials-summary"].hidden, false);
  assert.equal(popup.elements["centralino-form"].hidden, true);
  assert.equal(popup.elements["summary-interno"].textContent, "123");
  assert.equal(popup.elements.password.value, "");
  assert.match(popup.elements["save-status"].textContent, /Impossibile avviare/);
  assert.equal(popup.elements["save-status"].hidden, false);
  assert.equal(popup.elements["connection-status"].textContent, "Scollegato — riconnessione automatica");
  assert.equal(bridge.clients.length, 0);
  assert.equal(bridge.notifications.length, 0);
  popup.editCredentials();
  assert.equal(popup.elements["centralino-form"].hidden, false);
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

test("credenziali delle vecchie Opzioni e Centralino personalizzato persistono tra chiusure e riavvio di Chrome", async () => {
  const previousCredentials = { ...credentials, url: "https://precedente.wildixin.com" };
  const bridge = createCentralinoHarness(previousCredentials);
  await flush();
  bridge.clients[0].emit("connected");
  await flush();
  for (let opening = 0; opening < 2; opening += 1) {
    const popup = bridge.openPopup();
    await flush();
    assert.equal(popup.elements["centralino-form"].hidden, true);
    assert.equal(popup.elements["credentials-summary"].hidden, false);
    assert.equal(popup.elements["summary-interno"].textContent, "123");
    assert.equal(popup.elements.password.value, "");
    assert.equal(popup.elements["connection-status"].textContent, "Collegato");
    popup.close();
    assert.equal(bridge.clients.length, 1);
    assert.equal(bridge.notifications.length, 1);
  }
  assert.deepEqual(bridge.clients[0].credentials, previousCredentials);
  bridge.restartChrome();
  await flush();
  const popup = bridge.openPopup();
  await flush();
  assert.equal(bridge.clients.length, 2);
  assert.deepEqual(bridge.clients[1].credentials, previousCredentials);
  assert.equal(popup.elements["centralino-form"].hidden, true);
  assert.equal(popup.elements["connection-status"].textContent, "Scollegato — riconnessione automatica");
  assert.deepEqual(bridge.icon.path, redIconPaths);
  assert.equal(bridge.badge.text, "!");
  bridge.clients[1].emit("connected");
  await flush();
  assert.equal(popup.elements["connection-status"].textContent, "Collegato");
  assert.deepEqual(bridge.icon.path, greenIconPaths);
  assert.equal(bridge.badge.text, "");
});

test("Impostazioni avanzate conserva il Centralino personalizzato anche chiusa e applica solo l'indirizzo salvato", async () => {
  const previousCredentials = { ...credentials, url: "https://precedente.wildixin.com" };
  const bridge = createCentralinoHarness(previousCredentials);
  const popup = bridge.openPopup();
  await flush();
  popup.editCredentials();
  assert.equal(popup.elements["advanced-settings"].open, false);
  assert.equal(popup.elements.url.value, previousCredentials.url);
  popup.elements.interno.value = "456";
  await popup.save();
  await flush();
  assert.deepEqual(bridge.clients.at(-1).credentials, { ...previousCredentials, interno: "456" });
  popup.close();
  const reopenedPopup = bridge.openPopup();
  await flush();
  reopenedPopup.editCredentials();
  reopenedPopup.toggleAdvancedSettings();
  reopenedPopup.toggleAdvancedSettings();
  assert.equal(reopenedPopup.elements.url.value, previousCredentials.url);
  assert.equal(bridge.clients.length, 2);
  reopenedPopup.toggleAdvancedSettings();
  reopenedPopup.elements.url.value = "https://nuovo.wildixin.com/";
  reopenedPopup.toggleAdvancedSettings();
  assert.equal(bridge.local.centralinoSettings.url, previousCredentials.url);
  await reopenedPopup.save();
  await flush();
  assert.deepEqual(bridge.clients.at(-1).credentials, {
    ...previousCredentials, interno: "456", url: "https://nuovo.wildixin.com"
  });
  reopenedPopup.close();
  const latestPopup = bridge.openPopup();
  await flush();
  latestPopup.editCredentials();
  assert.equal(latestPopup.elements["advanced-settings"].open, false);
  assert.equal(latestPopup.elements.url.value, "https://nuovo.wildixin.com");
  assert.deepEqual(bridge.requestedOrigins, ["https://precedente.wildixin.com/*", "https://nuovo.wildixin.com/*"]);
});

test("Modifica credenziali non riavvia il collegamento finché non si salvano i nuovi dati", async () => {
  const bridge = createCentralinoHarness(credentials);
  const popup = bridge.openPopup();
  await flush();
  const oldClient = bridge.clients[0];
  oldClient.emit("connected");
  await flush();
  popup.editCredentials();
  assert.equal(popup.elements["centralino-form"].hidden, false);
  assert.equal(popup.elements["credentials-summary"].hidden, true);
  assert.equal(popup.elements.interno.value, "123");
  assert.equal(popup.document.activeElement, popup.elements.interno);
  assert.equal(popup.elements.password.type, "password");
  assert.equal(popup.elements["advanced-settings"].open, false);
  assert.equal(popup.elements["connection-status"].textContent, "Collegato");
  assert.equal(bridge.clients.length, 1);
  assert.equal(bridge.notifications.length, 1);
  assert.deepEqual(bridge.local.centralinoSettings, credentials);
  popup.elements.interno.value = "456";
  popup.elements.password.value = "password-sostituita";
  await popup.save();
  await flush();
  assert.equal(bridge.clients.length, 2);
  assert.deepEqual(bridge.clients[1].credentials, {
    ...credentials, interno: "456", password: "password-sostituita"
  });
  assert.equal(popup.elements["centralino-form"].hidden, true);
  assert.equal(popup.elements["summary-interno"].textContent, "456");
  assert.equal(popup.document.activeElement, popup.elements["edit-credentials"]);
  assert.equal(popup.elements.password.value, "");
  assert.equal(popup.elements["connection-status"].textContent, "Scollegato — riconnessione automatica");
  oldClient.emit("connected");
  await flush();
  assert.deepEqual(bridge.icon.path, redIconPaths);
  assert.equal(bridge.badge.text, "!");
  bridge.clients[1].emit("connected");
  await flush();
  assert.deepEqual(bridge.icon.path, greenIconPaths);
  assert.equal(bridge.badge.text, "");
  popup.close();
  const reopenedPopup = bridge.openPopup();
  await flush();
  assert.equal(reopenedPopup.elements.password.value, "");
  assert.equal(reopenedPopup.elements["summary-interno"].textContent, "456");
  assert.equal(reopenedPopup.elements["connection-status"].textContent, "Collegato");
  assert.ok(!JSON.stringify(bridge.logs).includes("password-sostituita"));
  assert.ok(!JSON.stringify(bridge.notifications).includes("password-sostituita"));
});

test("eventi Occupato/Libero di un collegamento sostituito non comandano Meet", async () => {
  const bridge = createCentralinoHarness(credentials);
  const popup = bridge.openPopup();
  await flush();
  const oldClient = bridge.clients[0];
  oldClient.emit("connected");
  await flush();
  popup.editCredentials();
  popup.elements.password.value = "password-sostituita";
  await popup.save();
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

test("una Chiamata Wildix rende Occupato anche senza uno stato iniziale delle chiamate", async () => {
  const bridge = createCentralinoHarness(credentials);
  await flush();
  const client = bridge.clients[0];
  client.emit("connected");
  const call = {
    getChannel: () => "SIP/123-001", getState: () => "ring", getDirection: () => "outgoing"
  };
  client.calls = [call];
  client.emit("call_added", call);
  await flush();
  assert.equal(bridge.session.centralinoConnected, true);
  assert.equal(bridge.session.internoOccupato ?? false, true);
  assert.equal(bridge.meetTab.mutedInfo.muted, true);

  client.emit("call_terminated", call);
  client.calls = [];
  await flush();
  assert.equal(bridge.session.internoOccupato, false);
  assert.equal(bridge.meetTab.mutedInfo.muted, false);
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
  const newCall = {
    getChannel: () => "SIP/123-002", getState: () => "ring", getDirection: () => "outgoing"
  };
  client.calls = [newCall];
  client.emit("call_added", newCall);
  await flush();
  client.emit("call_terminated", newCall);
  client.calls = [];
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
  assert.deepEqual(bridge.icon.path, redIconPaths);
  assert.equal(bridge.badge.text, "!");
  bridge.clients.at(-1).emit("disconnected");
  await flush();
  bridge.retryConnection();
  await flush();
  assert.equal(bridge.clients.length, 3);
  assert.deepEqual(bridge.icon.path, redIconPaths);
  assert.equal(bridge.badge.text, "!");
  assert.equal(bridge.notifications.length, 2);
  assert.equal(bridge.meetTab.mutedInfo.muted, true);

  const reconnectedClient = bridge.clients.at(-1);
  reconnectedClient.emit("connected");
  await flush();
  assert.deepEqual(bridge.icon.path, greenIconPaths);
  assert.equal(bridge.badge.text, "");
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
  assert.deepEqual(bridge.icon.path, greenIconPaths);
  assert.equal(bridge.badge.text, "");
  assert.equal(bridge.meetTab.mutedInfo.muted, false);
  assert.equal(bridge.notifications.length, 1);
});

test("al riavvio il worker corregge l'icona dopo cambi del collegamento non ancora ricevuti", async () => {
  const bridge = createCentralinoHarness(credentials);
  await flush();
  const client = bridge.clients[0];
  client.emit("connected");
  await flush();
  assert.deepEqual(bridge.icon.path, greenIconPaths);
  assert.equal(bridge.notifications.length, 1);

  bridge.stopWorker();
  client.emit("disconnected");
  await flush();
  assert.deepEqual(bridge.icon.path, greenIconPaths);
  bridge.restartWorker();
  await flush();
  assert.deepEqual(bridge.icon.path, redIconPaths);
  assert.equal(bridge.badge.text, "!");
  assert.equal(bridge.notifications.length, 2);
  assert.equal(bridge.clients.length, 1);

  bridge.stopWorker();
  client.emit("connected");
  await flush();
  assert.deepEqual(bridge.icon.path, redIconPaths);
  bridge.restartWorker();
  await flush();
  assert.deepEqual(bridge.icon.path, greenIconPaths);
  assert.equal(bridge.badge.text, "");
  assert.equal(bridge.notifications.length, 3);
  assert.equal(bridge.clients.length, 1);
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
  assert.deepEqual(bridge.icon.path, redIconPaths);
  assert.equal(bridge.badge.text, "!");
  assert.equal(bridge.meetTab.mutedInfo.muted, true);
  client.emit("connected");
  client.calls = [call];
  client.emit("call_added", call);
  await flush();
  client.emit("call_terminated", call);
  client.calls = [];
  await flush();
  assert.equal(bridge.meetTab.mutedInfo.muted, true);
  client.receiveCallsState([]);
  await flush();
  assert.deepEqual(bridge.icon.path, greenIconPaths);
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
    assert.deepEqual(bridge.icon.path, redIconPaths);
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

test("solo il popup fidato può salvare: mittenti estranei, content script e vecchie Opzioni non riavviano il Centralino", async () => {
  const bridge = createCentralinoHarness(credentials);
  await flush();
  bridge.clients[0].emit("connected");
  await flush();
  for (const [file, sender] of [
    ["src/wildix.js", {}],
    ["src/popup.html", { tab: { id: 1 } }],
    ["src/popup.html", { id: "altra-estensione" }],
    ["src/options.html", {}]
  ]) {
    assert.equal(await bridge.sendMessage({
      type: "CENTRALINO_SAVE_SETTINGS", settings: { ...credentials, password: "non-autorizzata" }
    }, file, sender), undefined);
    assert.equal(await bridge.sendMessage({ type: "CENTRALINO_GET_SETTINGS" }, file, sender), undefined);
  }
  await flush();
  assert.deepEqual(bridge.local.centralinoSettings, credentials);
  assert.equal(bridge.clients.length, 1);
  assert.equal(bridge.badge.text, "");
  assert.equal(bridge.notifications.length, 1);
  assert.equal(bridge.localAccessLevel, "TRUSTED_CONTEXTS");
});

test("il background ricontrolla dati e permesso prima di sovrascrivere la configurazione", async () => {
  const bridge = createCentralinoHarness(credentials);
  await flush();
  bridge.clients[0].emit("connected");
  await flush();
  const invalidResponse = await bridge.sendMessage({
    type: "CENTRALINO_SAVE_SETTINGS", settings: { ...credentials, url: "http://altro.wildixin.com" }
  });
  assert.match(invalidResponse.error, /HTTPS/);
  bridge.revokeHostPermission();
  const deniedResponse = await bridge.sendMessage({
    type: "CENTRALINO_SAVE_SETTINGS", settings: { ...credentials, url: "https://altro.wildixin.com" }
  });
  assert.match(deniedResponse.error, /negato/);
  assert.deepEqual(bridge.local.centralinoSettings, credentials);
  assert.equal(bridge.clients.length, 1);
  assert.equal(bridge.badge.text, "");
  assert.equal(bridge.notifications.length, 1);
});

test("una notifica non disponibile non fa apparire scollegato un Centralino collegato", async () => {
  const bridge = createCentralinoHarness(credentials);
  bridge.failNotifications();
  await flush();
  bridge.clients[0].emit("connected");
  await flush();
  assert.deepEqual(bridge.icon.path, greenIconPaths);
  assert.equal(bridge.badge.text, "");
  assert.equal(bridge.session.centralinoConnected, true);
});
