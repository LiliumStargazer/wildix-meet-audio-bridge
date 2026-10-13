(() => {
  const VERSION = chrome.runtime.getManifest().version;
  const PREFIX = `[Wildix Meet Audio Bridge v${VERSION}]`;

  chrome.runtime.onMessage.addListener(message => {
    if (message.type === "WILDIX_BUSY") {
      window.dispatchEvent(new CustomEvent("wildix-meet-bridge:occupato", {
        detail: message.busy === true
      }));
    }
  });

  chrome.runtime.sendMessage({
    type: "MEET_READY"
  }).catch(error => {
    console.warn(`${PREFIX} Impossibile notificare MEET_READY`, error);
  });
})();
