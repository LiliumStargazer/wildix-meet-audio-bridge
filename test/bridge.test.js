// Runs the real scripts against fake Chrome, microphone and Web Audio APIs.
// Run with: node --test
const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const FakeWTAPI = require("./fake-wtapi");

const readSource = file =>
  fs.readFileSync(path.join(__dirname, "..", "src", file), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8"));
const flush = () => new Promise(resolve => setImmediate(resolve));
const silentConsole = { log() {}, warn() {}, error() {} };

function createHarness({ tabMuted = false } = {}) {
  const store = {};
  const notifications = [];
  const injections = [];
  const installedListeners = [];
  const backgroundListeners = [];
  const meetListeners = [];
  const requests = [];
  const microphones = [];
  const audioContexts = [];
  const clients = [];
  const contexts = [];
  const tab = { id: 1, url: "https://meet.google.com/abc", mutedInfo: { muted: tabMuted } };
  const tabs = [tab];
  const removedListeners = [];
  const window = new EventTarget();
  let captureError = null;
  let audioError = null;
  let delayCapture = async () => {};
  let delayReady = async () => {};
  let notificationsFail = false;

  class FakeTrack extends EventTarget {
    constructor(kind, signal = () => 1) {
      super();
      this.kind = kind;
      this.enabled = true;
      this.readyState = "live";
      this.signal = signal;
      this.sample = () => this.enabled && this.readyState === "live" ? this.signal() : 0;
    }
    clone() {
      const clone = new FakeTrack(this.kind, this.signal);
      clone.enabled = this.enabled;
      clone.readyState = this.readyState;
      return clone;
    }
    stop() { this.readyState = "ended"; }
    end() { this.stop(); this.dispatchEvent(new Event("ended")); }
  }
  class FakeMediaStream {
    constructor(tracks) { this.tracks = tracks; }
    getTracks() { return this.tracks; }
    getAudioTracks() { return this.tracks.filter(track => track.kind === "audio"); }
    getVideoTracks() { return this.tracks.filter(track => track.kind === "video"); }
    // Native stream cloning bypasses overrides on individual track instances.
    clone() { return new FakeMediaStream(this.tracks.map(track => FakeTrack.prototype.clone.call(track))); }
  }
  class FakeAudioNode {
    connect(node) { node.input = this; return node; }
  }
  class FakeAudioContext {
    constructor() { this.state = "suspended"; audioContexts.push(this); }
    createMediaStreamSource(stream) {
      const source = new FakeAudioNode();
      source.sample = () => this.state === "running" ? stream.getAudioTracks()[0].sample() : 0;
      return source;
    }
    createGain() {
      const gain = new FakeAudioNode();
      gain.gain = { value: 1 };
      gain.sample = () => gain.input.sample() * gain.gain.value;
      return gain;
    }
    createMediaStreamDestination() {
      const destination = new FakeAudioNode();
      destination.stream = new FakeMediaStream([new FakeTrack("audio", () => destination.input.sample())]);
      return destination;
    }
    async resume() {
      if (audioError) throw audioError;
      this.state = "running";
    }
    async close() { this.state = "closed"; }
  }

  const mediaDevices = {
    async getUserMedia(...args) {
      assert.equal(this, mediaDevices);
      requests.push(args);
      await delayCapture();
      if (captureError) throw captureError;
      const constraints = args[0];
      const tracks = [];
      if (constraints.audio) tracks.push(new FakeTrack("audio"));
      if (constraints.video) tracks.push(new FakeTrack("video"));
      const stream = new FakeMediaStream(tracks);
      microphones.push(stream);
      return stream;
    }
  };
  function sendBackgroundMessage(message, sender) {
    return new Promise(resolve => {
      let hasResponse = false;
      for (const listener of backgroundListeners) {
        if (listener(message, sender, resolve) === true) hasResponse = true;
      }
      if (!hasResponse) resolve();
    });
  }
  class BridgeWTAPI extends FakeWTAPI {
    static ajax = { settings: {} };
    constructor() {
      super();
      clients.push(this);
    }
    connect() {
      this.listeners.connected();
      this.receiveCallsState();
    }
    disconnect() {
      this.calls.forEach(call => this.listeners.call_terminated(call));
      this.calls = [];
      this.listeners.disconnected();
    }
    addCall({ channel = "SIP/123-001", state = "ring", direction = "incoming" } = {}) {
      const call = {
        state,
        getChannel: () => channel,
        getState() { return this.state; },
        getDirection: () => direction
      };
      this.calls.push(call);
      this.listeners.call_added(call);
    }
    updateCall(channel, state) {
      const call = this.calls.find(call => call.getChannel() === channel);
      call.state = state;
      this.listeners.call_updated(call);
    }
    terminateCall(channel = "SIP/123-001") {
      const call = this.calls.find(call => call.getChannel() === channel);
      // WTAPI v1 emits termination before removing the call from its list.
      this.listeners.call_terminated(call);
      this.calls = this.calls.filter(call => call.getChannel() !== channel);
    }
  }

  const background = vm.createContext({
    console: silentConsole, URL, crypto,
    chrome: {
      runtime: {
        getManifest: () => manifest,
        getURL: file => `chrome-extension://bridge/${file}`,
        getContexts: async () => structuredClone(contexts),
        onMessage: { addListener: listener => backgroundListeners.push(listener) },
        onInstalled: { addListener: listener => installedListeners.push(listener) },
        onStartup: { addListener() {} }
      },
      notifications: { create: async options => {
        if (notificationsFail) throw new Error("Notifications unavailable");
        const iconUrl = new URL(options.iconUrl, "chrome-extension://bridge/src/background.js");
        if (!fs.existsSync(path.join(__dirname, "..", iconUrl.pathname.slice(1)))) {
          throw new Error("Unable to download all specified images.");
        }
        notifications.push(options);
      } },
      scripting: { executeScript: async options => { injections.push(options); } },
      action: { setIcon: async () => {}, setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
      storage: {
        local: {
          get: async () => ({ centralinoSettings: {
            interno: "123", password: "password-di-test", url: "https://automaticmachines.wildixin.com"
          } }),
          setAccessLevel: async () => {}
        },
        session: {
          get: async defaults => structuredClone(typeof defaults === "string"
            ? { [defaults]: store[defaults] }
            : { ...defaults, ...store }),
          set: async values => Object.assign(store, structuredClone(values))
        }
      },
      permissions: { contains: async () => true },
      offscreen: {
        createDocument: async () => {
          contexts.push({ documentUrl: "chrome-extension://bridge/src/offscreen.html" });
          vm.runInNewContext(readSource("offscreen.js"), {
            console: silentConsole, WTAPI: BridgeWTAPI, queueMicrotask,
            setTimeout: () => 1, clearTimeout() {},
            chrome: { runtime: {
              onMessage: { addListener() {} },
              sendMessage: message => sendBackgroundMessage(message, {
                url: "chrome-extension://bridge/src/offscreen.html"
              })
            } }
          });
        },
        closeDocument: async () => { contexts.length = 0; }
      },
      tabs: {
        query: async ({ url }) => {
          const patterns = Array.isArray(url) ? url : [url];
          return tabs.filter(tab => patterns.some(pattern =>
            tab.url.startsWith(pattern.replace(/\*$/, "")))).map(tab => structuredClone(tab));
        },
        update: async (id, { muted }) => {
          const target = tabs.find(tab => tab.id === id);
          if (!target) throw new Error("Tab closed");
          target.mutedInfo.muted = muted;
        },
        sendMessage: async (id, message) => {
          if (id !== tab.id || !meetListeners.length) throw new Error("Receiving end does not exist");
          meetListeners.forEach(listener => listener(message));
        },
        onRemoved: { addListener: listener => removedListeners.push(listener) }
      }
    }
  });
  background.importScripts = (...files) => files.forEach(file =>
    vm.runInContext(readSource(file), background));
  vm.runInContext(readSource("background.js"), background);

  const page = vm.createContext({
    window, navigator: { mediaDevices }, MediaStream: FakeMediaStream,
    MediaStreamTrack: FakeTrack,
    AudioContext: FakeAudioContext, CustomEvent, Event, console: silentConsole,
    // Any attempt to inspect or click Meet's controls fails the test.
    document: new Proxy({}, { get() { throw new Error("Meet controls accessed"); } })
  });
  const isolated = vm.createContext({
    window, CustomEvent, console: silentConsole,
    document: new Proxy({}, { get() { throw new Error("Meet controls accessed"); } }),
    chrome: {
      runtime: {
        id: "bridge",
        getManifest: () => manifest,
        onMessage: { addListener: listener => meetListeners.push(listener) },
        sendMessage: async message => {
          await delayReady();
          backgroundListeners.forEach(listener => listener(message, { tab: { id: tab.id } }));
        }
      }
    }
  });

  return {
    tab, notifications, injections, requests, microphones, audioContexts,
    MediaStream: FakeMediaStream,
    loadMeet() {
      vm.runInContext(readSource("meet-audio.js"), page);
      vm.runInContext(readSource("meet.js"), isolated);
    },
    getUserMedia: constraints => mediaDevices.getUserMedia(constraints),
    async addCall(call) {
      await flush();
      clients.at(-1).addCall(call);
      await flush();
    },
    async terminateCall(channel) {
      clients.at(-1).terminateCall(channel);
      await flush();
    },
    async updateCall(channel, state) {
      clients.at(-1).updateCall(channel, state);
      await flush();
    },
    async disconnectCentralino() {
      clients.at(-1).disconnect();
      await flush();
    },
    async reconnectCentralino() {
      clients.at(-1).listeners.connected();
      await flush();
    },
    async receiveCallsState() {
      clients.at(-1).receiveCallsState();
      await flush();
    },
    async sendTabMessage(message) {
      await sendBackgroundMessage({ connectionId: store.centralinoConnectionId, ...message }, {
        tab: { id: 99 }, url: "https://automaticmachines.wildixin.com/"
      });
      await flush();
    },
    async addMeetTab(muted = false) {
      const addedTab = { id: tabs.length + 1, url: "https://meet.google.com/new", mutedInfo: { muted } };
      tabs.push(addedTab);
      await sendBackgroundMessage({ type: "MEET_READY" }, { tab: addedTab });
      await flush();
      return addedTab;
    },
    async closeTab(id) {
      tabs.splice(tabs.findIndex(tab => tab.id === id), 1);
      removedListeners.forEach(listener => listener(id));
      await flush();
    },
    install: reason => Promise.all(installedListeners.map(listener => listener({ reason }))),
    denyCapture(error) { captureError = error; },
    failAudio(error) { audioError = error; },
    failNotifications() { notificationsFail = true; },
    delayCaptureUntil(promise) { delayCapture = () => promise; },
    delayReadyUntil(promise) { delayReady = () => promise; }
  };
}

describe("Silenziare Meet", () => {
  test("Occupato blocks the microphone signal and tab audio; Libero restores both", async () => {
    const bridge = createHarness();
    bridge.loadMeet();
    await flush();
    const stream = await bridge.getUserMedia({ audio: true });
    const mic = stream.getAudioTracks()[0];
    assert.equal(mic.sample(), 1);
    const notificationsBeforeCalls = bridge.notifications.length;

    await bridge.addCall();
    assert.equal(mic.sample(), 0);
    assert.equal(mic.enabled, true);
    assert.equal(bridge.tab.mutedInfo.muted, true);

    await bridge.terminateCall();
    assert.equal(mic.sample(), 1);
    assert.equal(mic.enabled, true);
    assert.equal(bridge.tab.mutedInfo.muted, false);
    assert.equal(bridge.notifications.length, notificationsBeforeCalls);
  });

  test("stopping Meet's microphone releases the real microphone and audio processing", async () => {
    const bridge = createHarness();
    bridge.loadMeet();
    await flush();
    const stream = await bridge.getUserMedia({ audio: true });
    stream.getAudioTracks()[0].stop();

    assert.equal(bridge.microphones[0].getAudioTracks()[0].readyState, "ended");
    assert.equal(bridge.audioContexts[0].state, "closed");
    await bridge.addCall();
    await bridge.terminateCall();
    assert.equal(stream.getAudioTracks()[0].sample(), 0);
  });

  test("live microphone clones stay controlled when other tracks stop, until the last clone stops", async () => {
    const bridge = createHarness();
    bridge.loadMeet();
    await flush();
    const stream = await bridge.getUserMedia({ audio: true });
    const mic = stream.getAudioTracks()[0];
    const firstClone = mic.clone();
    const lastClone = stream.clone().getAudioTracks()[0];
    mic.stop();
    firstClone.stop();
    assert.equal(lastClone.sample(), 1);
    assert.equal(bridge.microphones[0].getAudioTracks()[0].readyState, "live");

    await bridge.addCall();
    assert.equal(lastClone.sample(), 0);
    await bridge.terminateCall();
    assert.equal(lastClone.sample(), 1);
    lastClone.stop();
    assert.equal(bridge.microphones[0].getAudioTracks()[0].readyState, "ended");
    assert.equal(bridge.audioContexts[0].state, "closed");
  });

  test("clones of reassembled streams stay controlled until the last clone stops", async () => {
    const bridge = createHarness();
    bridge.loadMeet();
    await flush();
    const stream = await bridge.getUserMedia({ audio: true });
    const mic = stream.getAudioTracks()[0];
    const firstClone = new bridge.MediaStream([mic]).clone().getAudioTracks()[0];
    const lastClone = new bridge.MediaStream([firstClone]).clone().getAudioTracks()[0];
    mic.stop();
    firstClone.stop();
    assert.equal(lastClone.sample(), 1);
    assert.equal(bridge.microphones[0].getAudioTracks()[0].readyState, "live");

    await bridge.addCall();
    assert.equal(lastClone.sample(), 0);
    await bridge.terminateCall();
    assert.equal(lastClone.sample(), 1);
    lastClone.stop();
    assert.equal(bridge.microphones[0].getAudioTracks()[0].readyState, "ended");
    assert.equal(bridge.audioContexts[0].state, "closed");
  });

  test("a mixed stream's clones release each microphone independently and preserve video", async () => {
    const bridge = createHarness();
    bridge.loadMeet();
    await flush();
    const firstStream = await bridge.getUserMedia({ audio: true, video: true });
    const secondStream = await bridge.getUserMedia({ audio: true });
    const video = firstStream.getVideoTracks()[0];
    video.enabled = false;
    const mixedStream = new bridge.MediaStream([
      ...firstStream.getTracks(), ...secondStream.getTracks()
    ]).clone();
    const [firstClone, secondClone] = mixedStream.getAudioTracks();
    const clonedVideo = mixedStream.getVideoTracks()[0];
    assert.notEqual(clonedVideo, video);
    assert.equal(clonedVideo.enabled, false);
    firstStream.getTracks().forEach(track => track.stop());
    secondStream.getTracks().forEach(track => track.stop());

    assert.deepEqual([firstClone.sample(), secondClone.sample()], [1, 1]);
    await bridge.addCall();
    assert.deepEqual([firstClone.sample(), secondClone.sample()], [0, 0]);
    await bridge.terminateCall();
    firstClone.stop();
    assert.equal(secondClone.sample(), 1);
    assert.deepEqual(bridge.audioContexts.map(context => context.state), ["closed", "running"]);
    assert.equal(clonedVideo.readyState, "live");
    secondClone.stop();
    assert.deepEqual(bridge.audioContexts.map(context => context.state), ["closed", "closed"]);
    assert.ok(bridge.microphones.every(stream => stream.getAudioTracks()[0].readyState === "ended"));
  });

  test("a microphone switched off in Meet while Occupato stays off after Libero", async () => {
    const bridge = createHarness();
    bridge.loadMeet();
    await flush();
    const mic = (await bridge.getUserMedia({ audio: true })).getAudioTracks()[0];
    await bridge.addCall();
    mic.enabled = false;
    await bridge.terminateCall();
    assert.equal(mic.enabled, false);
    assert.equal(mic.sample(), 0);
  });

  test("a microphone switched on in Meet while Occupato stays silent until Libero", async () => {
    const bridge = createHarness();
    bridge.loadMeet();
    await flush();
    const mic = (await bridge.getUserMedia({ audio: true })).getAudioTracks()[0];
    mic.enabled = false;
    await bridge.addCall();
    mic.enabled = true;
    assert.equal(mic.sample(), 0);
    await bridge.terminateCall();
    assert.equal(mic.enabled, true);
    assert.equal(mic.sample(), 1);
  });

  test("a microphone already switched off in Meet stays off through Occupato and Libero", async () => {
    const bridge = createHarness();
    bridge.loadMeet();
    await flush();
    const mic = (await bridge.getUserMedia({ audio: true })).getAudioTracks()[0];
    mic.enabled = false;
    await bridge.addCall();
    await bridge.terminateCall();
    assert.equal(mic.enabled, false);
    assert.equal(mic.sample(), 0);
  });

  test("all microphones requested while Occupato stay silent until Libero", async () => {
    const bridge = createHarness();
    await bridge.addCall();
    bridge.loadMeet();
    await flush();
    const streams = await Promise.all([
      bridge.getUserMedia({ audio: true }), bridge.getUserMedia({ audio: true })
    ]);
    assert.deepEqual(streams.map(stream => stream.getAudioTracks()[0].sample()), [0, 0]);
    await bridge.terminateCall();
    assert.deepEqual(streams.map(stream => stream.getAudioTracks()[0].sample()), [1, 1]);
  });

  test("a microphone permission request completing after Occupato uses the latest state", async () => {
    const bridge = createHarness();
    bridge.loadMeet();
    await flush();
    let allowCapture;
    bridge.delayCaptureUntil(new Promise(resolve => { allowCapture = resolve; }));
    const pendingStream = bridge.getUserMedia({ audio: true });
    await bridge.addCall();
    allowCapture();
    const stream = await pendingStream;
    assert.equal(stream.getAudioTracks()[0].sample(), 0);
    await bridge.terminateCall();
    assert.equal(stream.getAudioTracks()[0].sample(), 1);
  });

  test("the signal stays closed until the initial state arrives from the background", async () => {
    const bridge = createHarness();
    await flush();
    let allowReady;
    bridge.delayReadyUntil(new Promise(resolve => { allowReady = resolve; }));
    bridge.loadMeet();
    const stream = await bridge.getUserMedia({ audio: true });
    assert.equal(stream.getAudioTracks()[0].sample(), 0);
    allowReady();
    await flush();
    assert.equal(stream.getAudioTracks()[0].sample(), 1);
  });

  test("Meet's audio constraints and video track reach Chrome unchanged", async () => {
    const bridge = createHarness();
    bridge.loadMeet();
    await flush();
    const constraints = {
      audio: {
        deviceId: { exact: "microphone-1" }, echoCancellation: false,
        noiseSuppression: true, autoGainControl: false, sampleRate: { ideal: 48000 }
      },
      video: { width: { ideal: 1280 } }
    };
    const expectedConstraints = structuredClone(constraints);
    const stream = await bridge.getUserMedia(constraints);
    assert.equal(bridge.requests[0][0], constraints);
    assert.deepEqual(bridge.requests[0], [expectedConstraints]);
    assert.equal(stream.getVideoTracks()[0], bridge.microphones[0].getVideoTracks()[0]);
  });

  test("video-only requests bypass microphone processing", async () => {
    const bridge = createHarness();
    bridge.loadMeet();
    const stream = await bridge.getUserMedia({ audio: false, video: true });
    assert.equal(stream, bridge.microphones[0]);
    assert.equal(bridge.audioContexts.length, 0);
  });

  test("video-only stream clones remain live when the original track stops", async () => {
    const bridge = createHarness();
    bridge.loadMeet();
    const stream = await bridge.getUserMedia({ audio: false, video: true });
    const clone = new bridge.MediaStream(stream.getTracks()).clone();
    stream.getVideoTracks()[0].stop();
    assert.notEqual(clone.getVideoTracks()[0], stream.getVideoTracks()[0]);
    assert.equal(clone.getVideoTracks()[0].readyState, "live");
    assert.equal(bridge.audioContexts.length, 0);
  });

  test("a disconnected real microphone also ends Meet's microphone and releases processing", async () => {
    const bridge = createHarness();
    bridge.loadMeet();
    const stream = await bridge.getUserMedia({ audio: true });
    const mic = stream.getAudioTracks()[0];
    const clone = mic.clone();
    const endedTracks = [];
    mic.addEventListener("ended", () => endedTracks.push("original"));
    clone.addEventListener("ended", () => endedTracks.push("clone"));
    bridge.microphones[0].getAudioTracks()[0].end();
    assert.deepEqual([mic.readyState, clone.readyState], ["ended", "ended"]);
    assert.deepEqual(endedTracks, ["original", "clone"]);
    assert.equal(bridge.audioContexts[0].state, "closed");
  });

  test("Chrome microphone errors reach Meet without starting audio processing", async () => {
    const bridge = createHarness();
    bridge.loadMeet();
    const error = new Error("Microphone permission denied");
    bridge.denyCapture(error);
    await assert.rejects(bridge.getUserMedia({ audio: true }), error);
    assert.equal(bridge.audioContexts.length, 0);
  });

  test("failed audio processing releases captured tracks instead of exposing an uncontrolled microphone", async () => {
    const bridge = createHarness();
    bridge.loadMeet();
    const error = new Error("Audio processing unavailable");
    bridge.failAudio(error);
    await assert.rejects(bridge.getUserMedia({ audio: true, video: true }), error);
    assert.deepEqual(bridge.microphones[0].getTracks().map(track => track.readyState), ["ended", "ended"]);
    assert.equal(bridge.audioContexts[0].state, "closed");
  });

  test("the tab's previous muted state is preserved", async () => {
    const bridge = createHarness({ tabMuted: true });
    bridge.loadMeet();
    await bridge.addCall();
    await bridge.terminateCall();
    assert.equal(bridge.tab.mutedInfo.muted, true);
  });

  test("tab audio is restored even if the tab leaves Meet while Occupato", async () => {
    const bridge = createHarness();
    bridge.loadMeet();
    await bridge.addCall();
    bridge.tab.url = "https://example.com/";
    await bridge.terminateCall();
    assert.equal(bridge.tab.mutedInfo.muted, false);
  });

  test("the microphone interception and state bridge start before Meet's scripts", () => {
    const scripts = manifest.content_scripts.filter(script => script.matches.includes("https://meet.google.com/*"));
    assert.equal(scripts.length, 2);
    assert.ok(scripts.every(script => script.run_at === "document_start"));
    assert.deepEqual(scripts.find(script => script.world === "MAIN").js, ["src/meet-audio.js"]);
    assert.deepEqual(scripts.find(script => script.world !== "MAIN").js, ["src/meet.js"]);
  });

  test("install and update ask to reload Meet instead of injecting into an uncovered meeting", async () => {
    for (const reason of ["install", "update"]) {
      const bridge = createHarness();
      await bridge.install(reason);
      assert.equal(bridge.notifications.length, 1);
      assert.match(bridge.notifications[0].message, /ricarica.*Google Meet/i);
      assert.deepEqual(bridge.injections, []);
    }
  });

  test("no extension script runs or is injected on Wildix Collaboration", async () => {
    assert.ok(manifest.content_scripts.every(script =>
      script.matches.every(pattern => pattern === "https://meet.google.com/*")));
    assert.ok(!manifest.permissions.includes("scripting"));
    const bridge = createHarness();
    bridge.tab.url = "https://automaticmachines.wildixin.com/";
    await bridge.install("update");
    assert.deepEqual(bridge.injections, []);
  });

  test("unavailable notifications do not abort installation", async () => {
    const bridge = createHarness();
    bridge.failNotifications();
    bridge.tab.url = "https://automaticmachines.wildixin.com/";
    await bridge.install("install");
    assert.deepEqual(bridge.injections, []);
  });
});

describe("Ripresa del collegamento al Centralino", () => {
  test("Meet resta silenziato durante lo scollegamento e torna allo Stato precedente dopo lo stato Libero", async () => {
    const bridge = createHarness();
    bridge.loadMeet();
    await flush();
    const mic = (await bridge.getUserMedia({ audio: true })).getAudioTracks()[0];
    const alreadyMutedTab = await bridge.addMeetTab(true);
    await bridge.addCall();
    await bridge.disconnectCentralino();
    assert.equal(mic.sample(), 0);
    assert.equal(bridge.tab.mutedInfo.muted, true);
    const newMeetTab = await bridge.addMeetTab();
    assert.equal(newMeetTab.mutedInfo.muted, true);

    await bridge.reconnectCentralino();
    assert.equal(mic.sample(), 0);
    assert.equal(bridge.tab.mutedInfo.muted, true);
    await bridge.receiveCallsState();
    assert.equal(mic.sample(), 1);
    assert.equal(bridge.tab.mutedInfo.muted, false);
    assert.equal(newMeetTab.mutedInfo.muted, false);
    assert.equal(alreadyMutedTab.mutedInfo.muted, true);
  });

  test("Libero resta invariato offline; una nuova Chiamata Wildix nella riconnessione silenzia Meet", async () => {
    const bridge = createHarness();
    bridge.loadMeet();
    await flush();
    const mic = (await bridge.getUserMedia({ audio: true })).getAudioTracks()[0];
    await bridge.disconnectCentralino();
    await bridge.addCall({ channel: "SIP/123-offline", direction: "outgoing" });
    assert.equal(mic.sample(), 1);
    assert.equal(bridge.tab.mutedInfo.muted, false);

    await bridge.reconnectCentralino();
    await bridge.receiveCallsState();
    assert.equal(mic.sample(), 0);
    assert.equal(bridge.tab.mutedInfo.muted, true);
    await bridge.terminateCall("SIP/123-offline");
    assert.equal(mic.sample(), 1);
    assert.equal(bridge.tab.mutedInfo.muted, false);
  });
});

describe("Occupato dal Centralino", () => {
  test("Chiamata Wildix in uscita silenzia Meet dall'avvio", async () => {
    const bridge = createHarness();
    bridge.loadMeet();
    await flush();
    const mic = (await bridge.getUserMedia({ audio: true })).getAudioTracks()[0];
    await bridge.addCall({ direction: "outgoing" });
    assert.equal(bridge.tab.mutedInfo.muted, true);
    assert.equal(mic.sample(), 0);
    await bridge.terminateCall();
    assert.equal(bridge.tab.mutedInfo.muted, false);
    assert.equal(mic.sample(), 1);
  });

  test("messaggi da Wildix Collaboration non possono cambiare Occupato o Libero", async () => {
    const bridge = createHarness();
    bridge.loadMeet();
    await flush();
    const mic = (await bridge.getUserMedia({ audio: true })).getAudioTracks()[0];
    await bridge.sendTabMessage({ type: "WILDIX_STATE_CHANGED", busy: true });
    await bridge.sendTabMessage({ type: "CENTRALINO_STATE_CHANGED", occupato: true, calls: [{}] });
    assert.equal(bridge.tab.mutedInfo.muted, false);
    assert.equal(mic.sample(), 1);
    await bridge.addCall();
    await bridge.sendTabMessage({ type: "WILDIX_STATE_CHANGED", busy: false });
    await bridge.sendTabMessage({ type: "CENTRALINO_STATE_CHANGED", occupato: false, calls: [] });
    assert.equal(bridge.tab.mutedInfo.muted, true);
    assert.equal(mic.sample(), 0);
  });

  test("tutte le schede Meet, anche aperte durante Occupato o uscite da Meet, riottengono lo Stato precedente", async () => {
    const bridge = createHarness();
    const alreadyMutedTab = await bridge.addMeetTab(true);
    await bridge.addCall();
    assert.equal(bridge.tab.mutedInfo.muted, true);
    assert.equal(alreadyMutedTab.mutedInfo.muted, true);
    const newMeetTab = await bridge.addMeetTab();
    assert.equal(newMeetTab.mutedInfo.muted, true);
    bridge.tab.url = "https://example.com/";
    await bridge.terminateCall();
    assert.equal(bridge.tab.mutedInfo.muted, false);
    assert.equal(alreadyMutedTab.mutedInfo.muted, true);
    assert.equal(newMeetTab.mutedInfo.muted, false);
  });

  test("chiudere una scheda Meet durante Occupato non impedisce il ripristino delle altre", async () => {
    const bridge = createHarness();
    const remainingTab = await bridge.addMeetTab();
    await bridge.addCall();
    await bridge.closeTab(bridge.tab.id);
    assert.equal(remainingTab.mutedInfo.muted, true);
    await bridge.terminateCall();
    assert.equal(remainingTab.mutedInfo.muted, false);
  });

  test("Chiamata Wildix di gruppo o coda presa da un collega riporta subito a Libero", async () => {
    for (const channel of ["SIP/123-gruppo", "SIP/123-coda"]) {
      const bridge = createHarness();
      bridge.loadMeet();
      await flush();
      const mic = (await bridge.getUserMedia({ audio: true })).getAudioTracks()[0];
      await bridge.addCall({ channel });
      assert.equal(bridge.tab.mutedInfo.muted, true);
      assert.equal(mic.sample(), 0);
      await bridge.terminateCall(channel);
      assert.equal(bridge.tab.mutedInfo.muted, false);
      assert.equal(mic.sample(), 1);
    }
  });

  test("attesa e Chiamate Wildix sovrapposte mantengono Occupato fino all'ultima chiusura", async () => {
    const bridge = createHarness();
    bridge.loadMeet();
    await flush();
    const mic = (await bridge.getUserMedia({ audio: true })).getAudioTracks()[0];
    await bridge.addCall();
    await bridge.updateCall("SIP/123-001", "hold");
    assert.equal(bridge.tab.mutedInfo.muted, true);
    assert.equal(mic.sample(), 0);
    await bridge.addCall({ channel: "SIP/123-002", state: "up", direction: "outgoing" });
    await bridge.terminateCall("SIP/123-002");
    assert.equal(bridge.tab.mutedInfo.muted, true);
    assert.equal(mic.sample(), 0);
    await bridge.terminateCall();
    assert.equal(bridge.tab.mutedInfo.muted, false);
    assert.equal(mic.sample(), 1);
  });

  test("squillo in entrata silenzia Meet fino alla chiusura, anche dopo la risposta", async () => {
    const bridge = createHarness();
    bridge.loadMeet();
    await flush();
    const mic = (await bridge.getUserMedia({ audio: true })).getAudioTracks()[0];
    await bridge.addCall();
    assert.equal(bridge.tab.mutedInfo.muted, true);
    assert.equal(mic.sample(), 0);
    await bridge.updateCall("SIP/123-001", "up");
    assert.equal(bridge.tab.mutedInfo.muted, true);
    assert.equal(mic.sample(), 0);
    await bridge.terminateCall();
    assert.equal(bridge.tab.mutedInfo.muted, false);
    assert.equal(mic.sample(), 1);
  });
});
