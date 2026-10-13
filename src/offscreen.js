let reconnectTimer;

function scheduleCentralinoReconnect() {
  if (reconnectTimer === undefined) {
    // Reload also disposes WTAPI's timers; its failed initial login never retries.
    reconnectTimer = setTimeout(() => location.reload(), 5000);
  }
}

(async () => {
  const { settings, connectionId, occupato } = await chrome.runtime.sendMessage({ type: "CENTRALINO_GET_SETTINGS" });
  const wtapi = new WTAPI(settings.interno, settings.password, settings.url);
  // MV3 forbids evaluating a server response as JavaScript.
  WTAPI.ajax.settings.dataType = "json";
  let isConnected = false;
  let isInternoOccupato = occupato;
  let canReportLibero = false;

  function reportInternoOccupato() {
    if (!isConnected) {
      return;
    }
    const calls = wtapi.telephony.getActiveCalls().map(call => ({
      channel: call.getChannel(), state: call.getState(), direction: call.getDirection()
    }));
    // A live call proves Occupato; clearing a retained Occupato needs a full state.
    if (!calls.length && !canReportLibero) {
      return;
    }
    isInternoOccupato = calls.length > 0;
    chrome.runtime.sendMessage({
      type: "CENTRALINO_STATE_CHANGED", occupato: isInternoOccupato, calls, connectionId
    }).catch(() => {
      console.error("[Wildix Meet Audio Bridge] Impossibile comunicare lo stato Occupato/Libero");
    });
  }

  function reportCentralinoConnection() {
    chrome.runtime.sendMessage({
      type: "CENTRALINO_CONNECTION_CHANGED", connected: isConnected, connectionId
    }).catch(() => {
      console.error("[Wildix Meet Audio Bridge] Impossibile comunicare lo stato del Centralino");
    });
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id === chrome.runtime.id && !sender.tab &&
        message.type === "CENTRALINO_SYNC" && message.connectionId === connectionId) {
      reportCentralinoConnection();
      queueMicrotask(reportInternoOccupato);
      sendResponse({ ok: true });
    }
  });

  // Observe even an empty state before WTAPI's telephony handler consumes it.
  wtapi.registerHandler("message", packet => {
    const event = packet.getChild("event", "urn:wildix:ami");
    if (isConnected && event?.getAttribute("type") === "state") {
      canReportLibero = true;
      queueMicrotask(reportInternoOccupato);
    }
    return false;
  }, null, 0);

  for (const [event, connected] of [["connected", true], ["disconnected", false]]) {
    wtapi.on(event, () => {
      isConnected = connected;
      canReportLibero = connected && !isInternoOccupato;
      if (connected) {
        clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
      } else {
        scheduleCentralinoReconnect();
      }
      reportCentralinoConnection();
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
  scheduleCentralinoReconnect();
});
