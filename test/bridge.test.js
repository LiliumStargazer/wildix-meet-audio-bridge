// Runs the real scripts against fake Chrome, microphone and Web Audio APIs.
// Run with: node --test
const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const readSource = file =>
  fs.readFileSync(path.join(__dirname, "..", "src", file), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8"));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
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
  const tab = { id: 1, url: "https://meet.google.com/abc", mutedInfo: { muted: tabMuted } };
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
  const background = vm.createContext({
    console: silentConsole,
    chrome: {
      runtime: {
        getManifest: () => manifest,
        getURL: file => `chrome-extension://bridge/${file}`,
        getContexts: async () => [],
        onMessage: { addListener: listener => backgroundListeners.push(listener) },
        onInstalled: { addListener: listener => installedListeners.push(listener) },
        onStartup: { addListener() {} }
      },
      notifications: { create: async options => {
        if (notificationsFail) throw new Error("Notifications unavailable");
        notifications.push(options);
      } },
      scripting: { executeScript: async options => { injections.push(options); } },
      action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
      storage: {
        local: { get: async () => ({}), setAccessLevel: async () => {} },
        session: {
          get: async defaults => structuredClone(typeof defaults === "string"
            ? { [defaults]: store[defaults] }
            : { ...defaults, ...store }),
          set: async values => Object.assign(store, structuredClone(values))
        }
      },
      tabs: {
        query: async ({ url }) => {
          const patterns = Array.isArray(url) ? url : [url];
          return patterns.some(pattern => tab.url.startsWith(pattern.replace(/\*$/, "")))
            ? [structuredClone(tab)] : [];
        },
        update: async (id, { muted }) => { tab.mutedInfo.muted = muted; },
        sendMessage: async (id, message) => {
          if (!meetListeners.length) throw new Error("Receiving end does not exist");
          meetListeners.forEach(listener => listener(message));
        },
        onRemoved: { addListener() {} }
      }
    }
  });
  background.importScripts = (...files) => files.forEach(file =>
    vm.runInContext(readSource(file), background));
  vm.runInContext(readSource("background.js"), background);

  const page = vm.createContext({
    window, navigator: { mediaDevices }, MediaStream: FakeMediaStream,
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
    loadMeet() {
      vm.runInContext(readSource("meet-audio.js"), page);
      vm.runInContext(readSource("meet.js"), isolated);
    },
    getUserMedia: constraints => mediaDevices.getUserMedia(constraints),
    async setWildixBusy(busy) {
      backgroundListeners.forEach(listener => listener(
        { type: "WILDIX_STATE_CHANGED", busy }, { tab: { id: 99 } }
      ));
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

    await bridge.setWildixBusy(true);
    assert.equal(mic.sample(), 0);
    assert.equal(mic.enabled, true);
    assert.equal(bridge.tab.mutedInfo.muted, true);

    await bridge.setWildixBusy(false);
    assert.equal(mic.sample(), 1);
    assert.equal(mic.enabled, true);
    assert.equal(bridge.tab.mutedInfo.muted, false);
    assert.deepEqual(bridge.notifications, []);
  });

  test("stopping Meet's microphone releases the real microphone and audio processing", async () => {
    const bridge = createHarness();
    bridge.loadMeet();
    await flush();
    const stream = await bridge.getUserMedia({ audio: true });
    stream.getAudioTracks()[0].stop();

    assert.equal(bridge.microphones[0].getAudioTracks()[0].readyState, "ended");
    assert.equal(bridge.audioContexts[0].state, "closed");
    await bridge.setWildixBusy(true);
    await bridge.setWildixBusy(false);
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

    await bridge.setWildixBusy(true);
    assert.equal(lastClone.sample(), 0);
    await bridge.setWildixBusy(false);
    assert.equal(lastClone.sample(), 1);
    lastClone.stop();
    assert.equal(bridge.microphones[0].getAudioTracks()[0].readyState, "ended");
    assert.equal(bridge.audioContexts[0].state, "closed");
  });

  test("a microphone switched off in Meet while Occupato stays off after Libero", async () => {
    const bridge = createHarness();
    bridge.loadMeet();
    await flush();
    const mic = (await bridge.getUserMedia({ audio: true })).getAudioTracks()[0];
    await bridge.setWildixBusy(true);
    mic.enabled = false;
    await bridge.setWildixBusy(false);
    assert.equal(mic.enabled, false);
    assert.equal(mic.sample(), 0);
  });

  test("a microphone switched on in Meet while Occupato stays silent until Libero", async () => {
    const bridge = createHarness();
    bridge.loadMeet();
    await flush();
    const mic = (await bridge.getUserMedia({ audio: true })).getAudioTracks()[0];
    mic.enabled = false;
    await bridge.setWildixBusy(true);
    mic.enabled = true;
    assert.equal(mic.sample(), 0);
    await bridge.setWildixBusy(false);
    assert.equal(mic.enabled, true);
    assert.equal(mic.sample(), 1);
  });

  test("a microphone already switched off in Meet stays off through Occupato and Libero", async () => {
    const bridge = createHarness();
    bridge.loadMeet();
    await flush();
    const mic = (await bridge.getUserMedia({ audio: true })).getAudioTracks()[0];
    mic.enabled = false;
    await bridge.setWildixBusy(true);
    await bridge.setWildixBusy(false);
    assert.equal(mic.enabled, false);
    assert.equal(mic.sample(), 0);
  });

  test("all microphones requested while Occupato stay silent until Libero", async () => {
    const bridge = createHarness();
    await bridge.setWildixBusy(true);
    bridge.loadMeet();
    await flush();
    const streams = await Promise.all([
      bridge.getUserMedia({ audio: true }), bridge.getUserMedia({ audio: true })
    ]);
    assert.deepEqual(streams.map(stream => stream.getAudioTracks()[0].sample()), [0, 0]);
    await bridge.setWildixBusy(false);
    assert.deepEqual(streams.map(stream => stream.getAudioTracks()[0].sample()), [1, 1]);
  });

  test("a microphone permission request completing after Occupato uses the latest state", async () => {
    const bridge = createHarness();
    bridge.loadMeet();
    await flush();
    let allowCapture;
    bridge.delayCaptureUntil(new Promise(resolve => { allowCapture = resolve; }));
    const pendingStream = bridge.getUserMedia({ audio: true });
    await bridge.setWildixBusy(true);
    allowCapture();
    const stream = await pendingStream;
    assert.equal(stream.getAudioTracks()[0].sample(), 0);
    await bridge.setWildixBusy(false);
    assert.equal(stream.getAudioTracks()[0].sample(), 1);
  });

  test("the signal stays closed until the initial state arrives from the background", async () => {
    const bridge = createHarness();
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
    await bridge.setWildixBusy(true);
    await bridge.setWildixBusy(false);
    assert.equal(bridge.tab.mutedInfo.muted, true);
  });

  test("tab audio is restored even if the tab leaves Meet while Occupato", async () => {
    const bridge = createHarness();
    bridge.loadMeet();
    await bridge.setWildixBusy(true);
    bridge.tab.url = "https://example.com/";
    await bridge.setWildixBusy(false);
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

  test("installation keeps reinjecting Wildix detection in already open Collaboration tabs", async () => {
    const bridge = createHarness();
    bridge.tab.url = "https://automaticmachines.wildixin.com/";
    await bridge.install("update");
    assert.deepEqual(bridge.injections.map(injection => Array.from(injection.files)), [
      ["src/wildix-rtc.js"], ["src/wildix.js"]
    ]);
  });

  test("unavailable notifications do not abort installation", async () => {
    const bridge = createHarness();
    bridge.failNotifications();
    bridge.tab.url = "https://automaticmachines.wildixin.com/";
    await bridge.install("install");
    assert.equal(bridge.injections.length, 2);
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
    assert.deepEqual(page.sent, [true]);

    call.close();
    await sleep(1200);
    assert.deepEqual(page.sent, [true, false]);
  });

  test("a call that never connects is not busy", async () => {
    const page = createWildixPage();
    new page.window.RTCPeerConnection().setState("failed");
    await sleep(1200);
    assert.deepEqual(page.sent, [false]);
  });
});
