// Runs the real background.js and meet.js against fake Chrome APIs and a fake
// Meet mic button. Run with: node --test
const { describe, test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const readSource = file =>
  fs.readFileSync(path.join(__dirname, "..", "src", file), "utf8");

const sleep = ms =>
  new Promise(resolve => setTimeout(resolve, ms));

const silentConsole = { log() {}, warn() {}, error() {} };

// Longer than meet.js CLICK_SETTLE_MS, so any retry click would have happened.
const SETTLE_MS = 2500;

function createHarness({
  micMuted = false,
  micPresent = true,
  latencyMs = 100,
  hasMutedAttribute = true,
  hasKnownLabels = true
} = {}) {
  const store = {};
  const tab = { id: 1, url: "https://meet.google.com/abc", mutedInfo: { muted: false } };
  const mic = { muted: micMuted, present: micPresent, clicks: 0 };
  const observers = new Set();
  let backgroundListener = null;
  let meetListener = null;
  let extensionAlive = true;

  const notifyObservers = () =>
    observers.forEach(observer => observer.callback());

  const usable = {
    isConnected: true,
    disabled: false,
    getClientRects: () => [{}]
  };

  // Meet also marks the camera with data-is-muted: it must never be clicked.
  const cameraButton = {
    ...usable,
    getAttribute: name => (name === "data-is-muted" ? "false" : null),
    querySelectorAll: () => [{ textContent: "videocam" }],
    click() { throw new Error("camera clicked"); }
  };

  const button = {
    ...usable,
    getAttribute: name =>
      name === "data-is-muted" && hasMutedAttribute ? String(mic.muted) : null,
    querySelectorAll: () => [{ textContent: mic.muted ? " mic_off " : "mic" }],
    click() {
      mic.clicks += 1;
      setTimeout(() => {
        mic.muted = !mic.muted;
        notifyObservers();
      }, latencyMs);
    }
  };

  const manifest = () => ({ version: "test", content_scripts: [] });

  vm.runInNewContext(readSource("background.js"), {
    console: silentConsole,
    chrome: {
      runtime: {
        getManifest: manifest,
        onMessage: { addListener: f => { backgroundListener = f; } },
        onInstalled: { addListener() {} }
      },
      storage: {
        session: {
          get: async defaults => structuredClone({
            ...defaults,
            ...Object.fromEntries(Object.keys(defaults).filter(k => k in store).map(k => [k, store[k]]))
          }),
          set: async values => Object.assign(store, structuredClone(values))
        }
      },
      tabs: {
        query: async () =>
          tab.url.startsWith("https://meet.google.com/") ? [structuredClone(tab)] : [],
        update: async (id, { muted }) => { tab.mutedInfo.muted = muted; },
        sendMessage: async (id, message) => {
          if (!meetListener) {
            throw new Error("Receiving end does not exist");
          }
          meetListener(message);
        },
        onRemoved: { addListener() {} }
      }
    }
  });

  function loadMeet() {
    class MutationObserver {
      constructor(callback) { this.callback = callback; }
      observe() { observers.add(this); }
      disconnect() { observers.delete(this); }
    }

    vm.runInNewContext(readSource("meet.js"), {
      console: silentConsole,
      setTimeout,
      MutationObserver,
      window: { getComputedStyle: () => ({ display: "block", visibility: "visible" }) },
      document: {
        body: {},
        querySelectorAll: selector => {
          if (selector.includes("region") || !mic.present) {
            return [];
          }
          if (selector === "button[data-is-muted]") {
            return hasMutedAttribute ? [cameraButton, button] : [cameraButton];
          }
          const isMuteButton = /Disattiva|Turn off/.test(selector);
          return hasKnownLabels && isMuteButton === !mic.muted ? [button] : [];
        }
      },
      chrome: {
        runtime: {
          getManifest: manifest,
          get id() { return extensionAlive ? "bridge" : undefined; },
          onMessage: { addListener: f => { meetListener = f; } },
          sendMessage: async message =>
            backgroundListener(message, { tab: { id: tab.id } })
        }
      }
    });
  }

  return {
    mic,
    tab,
    loadMeet,
    setWildixBusy: busy =>
      backgroundListener({ type: "WILDIX_STATE_CHANGED", busy }, { tab: { id: 99 } }),
    showMic() { mic.present = true; notifyObservers(); },
    userToggleMic() { mic.muted = !mic.muted; notifyObservers(); },
    invalidateExtension() { extensionAlive = false; }
  };
}

describe("Wildix Meet Audio Bridge", { concurrency: true }, () => {
  test("mutes mic and tab audio during a call, then restores both", async () => {
    const w = createHarness();
    w.loadMeet();
    w.setWildixBusy(true);
    await sleep(SETTLE_MS);
    assert.deepStrictEqual([w.mic.muted, w.tab.mutedInfo.muted], [true, true]);

    w.setWildixBusy(false);
    await sleep(SETTLE_MS);
    assert.deepStrictEqual([w.mic.muted, w.tab.mutedInfo.muted], [false, false]);
  });

  test("leaves an already muted mic muted after the call", async () => {
    const w = createHarness({ micMuted: true });
    w.loadMeet();
    w.setWildixBusy(true);
    await sleep(200);
    w.setWildixBusy(false);
    await sleep(SETTLE_MS);
    assert.deepStrictEqual([w.mic.muted, w.mic.clicks], [true, 0]);
  });

  test("a slow Meet does not get clicked twice", async () => {
    const w = createHarness({ latencyMs: 1000 });
    w.loadMeet();
    w.setWildixBusy(true);
    await sleep(SETTLE_MS);
    assert.strictEqual(w.mic.muted, true);

    w.setWildixBusy(false);
    await sleep(SETTLE_MS + 1000);
    assert.deepStrictEqual([w.mic.muted, w.mic.clicks], [false, 2]);
  });

  test("a call ending right after the mute click still ends unmuted", async () => {
    const w = createHarness({ latencyMs: 500 });
    w.loadMeet();
    w.setWildixBusy(true);
    await sleep(100);
    w.setWildixBusy(false);
    await sleep(2 * SETTLE_MS);
    assert.deepStrictEqual([w.mic.muted, w.mic.clicks], [false, 2]);
  });

  test("mutes the mic as soon as Meet shows it", async () => {
    const w = createHarness({ micPresent: false });
    w.loadMeet();
    w.setWildixBusy(true);
    await sleep(300);
    w.showMic();
    await sleep(300);
    assert.strictEqual(w.mic.muted, true);
  });

  test("mutes a Meet tab opened during the call", async () => {
    const w = createHarness();
    w.setWildixBusy(true);
    await sleep(100);
    w.loadMeet();
    await sleep(300);
    assert.deepStrictEqual([w.mic.muted, w.tab.mutedInfo.muted], [true, true]);
  });

  test("does not re-mute a mic the user turns back on right away", async () => {
    const w = createHarness();
    w.loadMeet();
    w.setWildixBusy(true);
    await sleep(300);
    w.userToggleMic();
    await sleep(SETTLE_MS);
    assert.deepStrictEqual([w.mic.muted, w.mic.clicks], [false, 1]);
  });

  test("restores the audio of a tab that left Meet during the call", async () => {
    const w = createHarness();
    w.loadMeet();
    w.setWildixBusy(true);
    await sleep(100);
    w.tab.url = "https://example.com/";
    w.setWildixBusy(false);
    await sleep(100);
    assert.strictEqual(w.tab.mutedInfo.muted, false);
  });

  test("does not re-mute a mic the user turned back on", async () => {
    const w = createHarness();
    w.loadMeet();
    w.setWildixBusy(true);
    await sleep(SETTLE_MS);
    w.userToggleMic();
    await sleep(SETTLE_MS);
    assert.deepStrictEqual([w.mic.muted, w.mic.clicks], [false, 1]);
  });

  test("works with Meet in another language", async () => {
    const w = createHarness({ hasKnownLabels: false });
    w.loadMeet();
    w.setWildixBusy(true);
    await sleep(300);
    assert.strictEqual(w.mic.muted, true);
  });

  test("falls back to the mic label without data-is-muted", async () => {
    const w = createHarness({ hasMutedAttribute: false });
    w.loadMeet();
    w.setWildixBusy(true);
    await sleep(300);
    assert.strictEqual(w.mic.muted, true);
  });

  test("an orphaned script stops touching the mic", async () => {
    const w = createHarness({ micPresent: false });
    w.loadMeet();
    w.setWildixBusy(true);
    await sleep(100);
    w.invalidateExtension();
    w.showMic();
    await sleep(300);
    assert.deepStrictEqual([w.mic.muted, w.mic.clicks], [false, 0]);
  });
});

// Runs the real wildix-rtc.js and wildix.js in one fake page.
function createWildixPage() {
  const window = new EventTarget();
  const sent = [];

  window.RTCPeerConnection = class extends EventTarget {
    connectionState = "new";
    setState(state) {
      this.connectionState = state;
      this.dispatchEvent(new Event("connectionstatechange"));
    }
    close() { this.connectionState = "closed"; }
  };

  vm.runInNewContext(readSource("wildix-rtc.js"), { window, CustomEvent });
  vm.runInNewContext(readSource("wildix.js"), {
    window,
    CustomEvent,
    console: silentConsole,
    setTimeout,
    clearTimeout,
    MutationObserver: class { observe() {} },
    document: { documentElement: {}, querySelector: () => null },
    chrome: {
      runtime: {
        getManifest: () => ({ version: "test" }),
        sendMessage: async message => { sent.push(message.busy); }
      }
    }
  });

  return { window, sent };
}

describe("Wildix call detection", { concurrency: true }, () => {
  test("a connected WebRTC call is busy until it is closed", async () => {
    const page = createWildixPage();
    const call = new page.window.RTCPeerConnection();
    call.setState("connecting");
    call.setState("connected");
    assert.deepStrictEqual(page.sent, [true]);

    call.close();
    await sleep(1200);
    assert.deepStrictEqual(page.sent, [true, false]);
  });

  test("a call that never connects is not busy", async () => {
    const page = createWildixPage();
    new page.window.RTCPeerConnection().setState("failed");
    await sleep(1200);
    assert.deepStrictEqual(page.sent, [false]);
  });
});
