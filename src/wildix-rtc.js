// Runs in the page's own JS world (MAIN) at document_start, so it sees the
// WebRTC connections the Wildix browser phone opens for calls. wildix.js
// treats Wildix as busy while one is connected, whatever its UI looks like.
(() => {
  // Survives extension updates in the page: patch only once.
  if (window.wildixMeetBridgeRtc || !window.RTCPeerConnection) {
    return;
  }

  window.wildixMeetBridgeRtc = true;

  const connected = new Set();

  const report = () =>
    window.dispatchEvent(
      new CustomEvent("wildix-meet-bridge:rtc", {
        detail: connected.size > 0
      })
    );

  window.RTCPeerConnection = class extends window.RTCPeerConnection {
    constructor(...args) {
      super(...args);

      this.addEventListener("connectionstatechange", () => {
        if (this.connectionState === "connected") {
          connected.add(this);
        } else {
          connected.delete(this);
        }

        report();
      });
    }

    // close() fires no connectionstatechange, so the hang-up is caught here.
    close() {
      connected.delete(this);
      report();

      return super.close();
    }
  };

  window.addEventListener("wildix-meet-bridge:rtc-query", report);
})();
