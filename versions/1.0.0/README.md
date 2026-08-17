# HApps JS SDK 1.0.0

## CDN

```html
<script src="https://cdn.hooli.games/sdk/1.0.0/hooligapps.js"></script>
```

## Initialization

```js
const { ready } = HApps.init({
  platformOrigin: "https://hooli.games",
  ssoLoginUrl: "https://game.example.com/api/hooli/sign",
  gameInstance: unityInstance,
  unityObjectName: "HAppsJSBridge",
  unityMethodName: "OnMessage"
});

ready.catch(console.error);
```

Optional configuration: `isPortal`, `maxRetries`, and `retryDelayMs`.

## JavaScript API

```js
HApps.getUser();
HApps.isReady();
HApps.isPortal();
HApps.getVersion();
HApps.requestAuth();
HApps.setFullscreen(true);
HApps.destroy();
```

Event listeners: `init`, `ready`, `profile`, `auth_complete`, `user_changed`, `payment`, `payment_complete`, `popup_auth_result`, and `error`.

```js
HApps.on("user_changed", callback);
HApps.once("error", callback);
HApps.off("user_changed", callback);
```

## Unity WebGL

```js
HApps.onUnityEvent(type, JSON.stringify(payload));
```

Unity input events:

- `init`
- `portal_auth`
- `get_profile`
- `open_payment` with `{ "orderId": "..." }`
- `popup_auth` with `{ "url": "https://..." }`

Unity output events:

- `init`
- `profile`
- `auth_complete`
- `user_changed`
- `payment`
- `payment_complete`
- `popup_auth_result`
- `error`
