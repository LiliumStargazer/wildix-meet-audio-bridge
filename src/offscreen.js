(async () => {
  const { settings, connectionId } = await chrome.runtime.sendMessage({ type: "CENTRALINO_GET_SETTINGS" });
  const wtapi = new WTAPI(settings.interno, settings.password, settings.url);
  // MV3 forbids evaluating a server response as JavaScript.
  WTAPI.ajax.settings.dataType = "json";
  for (const [event, connected] of [["connected", true], ["disconnected", false]]) {
    wtapi.on(event, () => {
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
    });
  }
  wtapi.connect();
})().catch(() => {
  console.error("[Wildix Meet Audio Bridge] Impossibile collegarsi al Centralino");
});
