export function createPortalTransport(browserWindow, platformOrigin, onMessage) {
  function handleMessage(event) {
    if (event.origin !== platformOrigin) return;
    if (event.source !== browserWindow.parent) return;
    onMessage(event.data);
  }

  return {
    start: function() {
      browserWindow.addEventListener("message", handleMessage, false);
    },
    post: function(message) {
      browserWindow.parent.postMessage(message, platformOrigin);
    },
    destroy: function() {
      browserWindow.removeEventListener("message", handleMessage, false);
    },
  };
}

