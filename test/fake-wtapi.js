class FakeWTAPI {
  constructor() {
    this.listeners = {};
    this.calls = [];
    this.messageHandlers = [{ priority: 10, callback: packet => {
      const event = packet.getChild("event", "urn:wildix:ami");
      if (!event) return false;
      this.calls = event.calls;
      this.calls.forEach(call => this.listeners.call_added(call));
      return true;
    } }];
    this.telephony = {
      on: (event, listener) => { this.listeners[event] = listener; },
      getActiveCalls: () => this.calls.slice()
    };
  }

  on(event, listener) { this.listeners[event] = listener; }

  registerHandler(event, callback, scope, priority) {
    this.messageHandlers.push({ priority, callback: packet => callback.call(scope, packet) });
    this.messageHandlers.sort((first, second) => first.priority - second.priority);
  }

  receiveCallsState(calls = this.calls) {
    const packet = { getChild: (name, namespace) => namespace === "urn:wildix:ami"
      ? { calls, getAttribute: () => "state" } : null };
    this.messageHandlers.some(handler => handler.callback(packet));
  }
}

module.exports = FakeWTAPI;
