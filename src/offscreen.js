(async () => {
  const { settings, connectionId } = await chrome.runtime.sendMessage({ type: "CENTRALINO_GET_SETTINGS" });
  const wtapi = new WTAPI(settings.interno, settings.password, settings.url);
  // MV3 forbids evaluating a server response as JavaScript.
  WTAPI.ajax.settings.dataType = "json";
  let isConnected = false;

  function reportInternoOccupato() {
    if (!isConnected) {
      return;
    }
    const calls = wtapi.telephony.getActiveCalls().map(call => ({
      channel: call.getChannel(), state: call.getState(), direction: call.getDirection()
    }));
    chrome.runtime.sendMessage({
      type: "CENTRALINO_STATE_CHANGED", occupato: calls.length > 0, calls, connectionId
    }).catch(() => {
      console.error("[Wildix Meet Audio Bridge] Impossibile comunicare lo stato Occupato/Libero");
    });
  }

  for (const [event, connected] of [["connected", true], ["disconnected", false]]) {
    wtapi.on(event, () => {
      isConnected = connected;
      if (connected) {
        queueMicrotask(reportInternoOccupato);
      }
      chrome.runtime.sendMessage({
        type: "CENTRALINO_CONNECTION_CHANGED", connected, connectionId
      }).catch(() => {
        console.error("[Wildix Meet Audio Bridge] Impossibile comunicare lo stato del Centralino");
      });
    });
  }
  for (const event of ["call_added", "call_updated", "call_terminated"]) {
    wtapi.telephony.on(event, call => {
      console.log("[Wildix Meet Audio Bridge]", event, {
        channel: call.getChannel(), state: call.getState(), direction: call.getDirection()
      });
      // WTAPI v1 removes terminated calls only after firing the event.
      queueMicrotask(reportInternoOccupato);
    });
  }
  wtapi.connect();
})().catch(() => {
  console.error("[Wildix Meet Audio Bridge] Impossibile collegarsi al Centralino");
});
