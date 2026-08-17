export function createEmitter() {
  var listeners = Object.create(null);

  function on(eventType, callback) {
    if (typeof callback !== "function") {
      throw new TypeError("Event callback must be a function");
    }
    if (!listeners[eventType]) listeners[eventType] = [];
    listeners[eventType].push(callback);
    return function unsubscribe() {
      off(eventType, callback);
    };
  }

  function once(eventType, callback) {
    var unsubscribe = on(eventType, function(data) {
      unsubscribe();
      callback(data);
    });
    return unsubscribe;
  }

  function off(eventType, callback) {
    if (!listeners[eventType]) return;
    listeners[eventType] = listeners[eventType].filter(function(listener) {
      return listener !== callback;
    });
  }

  function emit(eventType, data) {
    var current = (listeners[eventType] || []).slice();
    for (var i = 0; i < current.length; i += 1) {
      try {
        current[i](data);
      } catch (_) {
        // A consumer callback must not interrupt SDK message processing.
      }
    }
  }

  function clear() {
    listeners = Object.create(null);
  }

  return { on: on, once: once, off: off, emit: emit, clear: clear };
}

