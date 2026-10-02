# HApps JS SDK 1.1.0

Browser SDK for Hooli Games portal integration. Supports JavaScript, TypeScript, and Unity WebGL.

## Install

```bash
npm install happs-js-sdk
```

## JavaScript / TypeScript

```ts
import HApps from "happs-js-sdk";

const { ready } = HApps.init({
  platformOrigin: "https://hooli.games",
  ssoLoginUrl: "/api/hooli/sign",
});

const connection = await ready;
```

Create an independent client:

```ts
import { createHAppsClient } from "happs-js-sdk/core";

const client = createHAppsClient({
  platformOrigin: "https://hooli.games",
  ssoLoginUrl: "/api/hooli/sign",
});

await client.connect();
```

## CDN

```html
<script src="https://cdn.hooli.games/sdk/1.1.0/hooligapps.js"></script>
<script>
  HApps.init({
    platformOrigin: "https://hooli.games",
    ssoLoginUrl: "/api/hooli/sign"
  });
</script>
```

## Unity WebGL

```js
const { ready } = HApps.init({
  platformOrigin: "https://hooli.games",
  ssoLoginUrl: "/api/hooli/sign"
});

HApps.unity.attach({
  gameInstance: unityInstance,
  objectName: "HAppsJSBridge",
  methodName: "OnMessage"
});

HApps.unity.receive("init");
ready.catch(console.error);
```

From a module:

```ts
import { createHAppsClient } from "happs-js-sdk/core";
import { createUnityBridge } from "happs-js-sdk/unity";

const client = createHAppsClient({
  platformOrigin: "https://hooli.games",
  ssoLoginUrl: "/api/hooli/sign",
});

const unity = createUnityBridge(client, {
  gameInstance: unityInstance,
  objectName: "HAppsJSBridge",
  methodName: "OnMessage",
});

unity.receive("init");
```

## Configuration

| Option | Required | Default |
| --- | --- | --- |
| `platformOrigin` | Yes | — |
| `ssoLoginUrl` | No | `/api/sign` |
| `isPortal` | No | `true` |
| `maxRetries` | No | `3` |
| `retryDelayMs` | No | `1000` |
| `operationTimeoutMs` | No | `180000` |
| `debug` | No | `false` |

## API

```ts
await HApps.connect();
await HApps.getProfile();
await HApps.openPortalAuth();
await HApps.openIdpAuthPopup("/api/hooli/idp");
await HApps.openPayment(orderId);

HApps.setFullscreen(true);
HApps.setTheaterMode(true);
// Subscribe before opening the confirmation dialog.
HApps.on("age_verification_complete", ({ verified }) => {
  if (verified) {
    // The player confirmed 18+ in the portal dialog.
  }
});
HApps.openAgeVerification();
HApps.destroy();
```

Events:

```ts
const unsubscribe = HApps.on("user_changed", ({ userData }) => {
  console.log(userData);
});

unsubscribe();
```

Available events: `ready`, `auth_complete`, `user_changed`, `payment`, `payment_complete`, `age_verification_complete`, `popup_auth_result`, and `error`.

## Build

```bash
npm run build
```

The build generates `index.js`, `dist/*`, and `versions/1.1.0/*`.

### Authentication action

The portal may include `action` in its `auth_complete` message. The SDK validates
and forwards it to `auth_complete` listeners and the Unity bridge after SSO completes.
The optional field uses the TypeScript union `AuthAction = "sign_up" | "linked" | "login"`:

- `"sign_up"`: a new user was created.
- `"linked"`: game progress was linked to an existing user.
- `"login"`: an existing user signed in.

Messages from older portals and cancelled auth flows may omit `action`.
Unity portal auth for an already verified user returns `"login"`.
