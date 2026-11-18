# HApps JS SDK 1.2.0

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
<script src="https://cdn.hooli.games/sdk/1.2.0/hooligapps.js"></script>
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
HApps.on("age_verification_complete", ({ confirmed }) => {
  if (confirmed) {
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

`HApps.getUser()?.locale` is the portal language when supplied (for example, `en` or `pt-BR`). It is updated on launch, authentication, and portal language changes. Subscribe to `user_changed` for updated user data; games should fall back when the locale is missing or unsupported.

## Build

```bash
npm run build
```

The build generates `index.js`, `dist/*`, and `versions/1.2.0/*`.

### Authentication action

The portal may include `action` in its `auth_complete` message. The SDK validates
and forwards it to `auth_complete` listeners and the Unity bridge after SSO completes.
The optional field uses the TypeScript union `AuthAction = "sign_up" | "linked" | "login"`:

- `"sign_up"`: a new user was created.
- `"linked"`: game progress was linked to an existing user.
- `"login"`: an existing user signed in.

Messages from older portals and cancelled auth flows may omit `action`.
Unity portal auth for an already verified user returns `"login"`.

## Identity fields

`portalId` is the shared visitor UUID from the portal users table. `userId` is always the game user identifier (`GameLink.uid`). `linkId` is the GameLink UUID; in browser SDK user data this is `id`, and in launch tokens it is `sub`. `accId` identifies a registered portal account. The portal does not send its shared visitor UUID in the game launch token.

Browser SDK 1.2.0 uses `getUser().userId` for the game identifier. The portal preserves passion-industry's old `userId = id` exception only for SDKs below 1.2.0 or without a version. Node/Python binding and payment methods use userId/user_id.

## Publish browser SDK to CDN

Build and publish from this repository:

```bash
npm run build
npm run deploy:cdn -- --version 1.2.0 --dry-run
npm run deploy:cdn -- --version 1.2.0
```

The script uploads `versions/<version>/*` to `sdk/<version>/*`. Omitting
`--version` uploads all files under `versions`. Existing unversioned CDN aliases
are not changed. Versioned files retain the one-year immutable cache policy;
publish a new version when changing a released SDK.

Supply `S3_ENDPOINT`, `S3_BUCKET`, `S3_KEY_ID`, and `S3_APPLICATION_KEY` through
the environment or a local, ignored `.env` in this repository. `S3_REGION` is
optional and defaults to `eu-central-003`. Do not commit credentials.
`--dry-run` lists planned object keys without reading `.env` or contacting S3.
Use `--sdk-dir <directory>` or `--sdk-prefix <prefix>` to override the source
and destination prefix. Publishing uses development dependencies, so install
with `npm install` rather than `--omit=dev`.

Cancelled portal authentication emits `{ type: "auth_complete", action: "cancel" }` with the current profile in `userData` when available and without `signatureData`. The current SDK profile is preserved. A tokenless response without an action is treated as cancellation.

## Age verification outside the portal


Games can verify age on their own domain without a Hooli account. The game server owns the player/session and stores the result. No portal visitor or account is created by this flow.

## Browser

Initialize HApps as usual. Open the popup directly from a user click:

```js
const result = await HApps.openAgeVerificationPopup('/api/age-verification');
if (result.confirmed) startGame();
```

The promise resolves with `{ confirmed: true }` or `{ confirmed: false, reason: 'cancelled' | 'failed' | 'pending' }`. Blocked popups, invalid URLs and a 15-minute timeout reject the promise. Cancellation does not confirm age. The existing `openAgeVerification()` method requests the portal's age gate for embedded games; use `openAgeVerificationPopup()` on a game's own site.

The popup start and callback endpoints must be on the game's origin. For a different callback origin, pass it as the second argument and implement a callback page with an explicit opener target origin. SDK checks both the sender origin and the popup window. A message from the portal/Yoti callback does not grant confirmation.

Unity bridge input: `{ type: 'popup_age_verification', url: '/api/age-verification' }`. Output: `{ type: 'popup_age_verification_result', confirmed: true }` or the same false/reason result. Technical errors use the existing error message.

## Game server: Node.js

Register the exact callback URL in the game's client callback URLs in the portal administration. Use the Bridge client ID and API secret on the server. Callback validation permits HTTPS and HTTP localhost for development. Serve game endpoints over HTTPS with a session cookie suitable for top-level cross-site GET redirects (`SameSite=Lax`).

```js
// Express example. `client` is an initialized HAppsClient.
const callbackUrl = 'https://game.example/api/age-verification/callback';

app.get('/api/age-verification', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    if (req.session.ageConfirmed === true) {
      return res.type('html').send(client.ageVerificationPopupResponse({ confirmed: true }));
    }
    const query = new URL(req.originalUrl, callbackUrl).searchParams;
    const options = query.has('utm_campaign') ? { utm_campaign: query.get('utm_campaign') } : {};
    const request = await client.createAgeVerificationRequest(callbackUrl, options);
    req.session.ageVerificationState = request.state;
    // Persist state before leaving the game; bind it to this session/player.
    req.session.save(error => error ? next(error) : res.redirect(303, request.url));
  } catch (error) { next(error); }
});

app.get('/api/age-verification/callback', async (req, res, next) => {
  try {
    const expectedState = req.session.ageVerificationState;
    // Use the configured URL, never a callback origin supplied by the browser.
    const callback = new URL(callbackUrl);
    callback.search = new URL(req.originalUrl, callbackUrl).search;
    const result = await client.exchangeAgeVerificationCode(callback.toString(), expectedState);
    delete req.session.ageVerificationState;
    if (result.confirmed) req.session.ageConfirmed = true;
    // Optionally persist confirmation for the current game player in the game's DB.
    req.session.save(error => {
      if (error) return next(error);
      res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
      res.type('html').send(client.ageVerificationPopupResponse(result));
    });
  } catch (error) { next(error); }
});
```

Store outstanding state on the server. Validate it against the same game session in the callback, then exchange the code before granting access. On errors, offer a fresh attempt. An exchanged code cannot be retried; if saving the game session fails, start a new request. Gameplay endpoints must enforce the server's saved confirmation, independently of the browser promise.

## Game server: Python

Both sync `HAppsClient` and async `AsyncHAppsClient` provide the same methods:

```python
request = client.create_age_verification_request(callback_url)
session['age_verification_state'] = request['state']
# Save session and redirect the popup to request['url'].

result = client.exchange_age_verification_code(
    full_callback_url, session['age_verification_state']
)
session.pop('age_verification_state', None)
if result['confirmed']:
    session['age_confirmed'] = True
# Persist the session/player first, then return as text/html with Cache-Control: no-store:
html = client.age_verification_popup_response(result)
```

For the async client, await the create/exchange methods. The HTML helper is synchronous. Use a configured callback origin, preserve the callback query and persist the session before redirecting or returning the HTML.

## Portal exchange

Both endpoints use the existing Bridge HMAC request authentication:

- `POST /api/v1/bridge/age-verification`: `{ callbackUrl, state }` → `{ url, state, expiresIn }`.
- `POST /api/v1/bridge/age-verification/exchange`: `{ code, state }` → the confirmation result.

Requests expire after 30 minutes. `state` is generated by the server SDK (32 random bytes) and stored by the game. Result codes expire after five minutes and can be consumed only once by the requesting game with the matching state. Return URLs must match a registered callback URL exactly.

Hooli asks for explicit 18+ confirmation and applies its regional Yoti policy using the browser's IP. Missing required location/provider data returns an error. Where provider verification is required, Hooli obtains the authoritative result from Yoti. The popup returns to the game's callback with `code` and `state`; the game server exchanges them, persists the result, then sends `age_verification_done` to its opener and closes the popup. Provider pending status is polled in the popup. This external flow supports Yoti; document submission and manual review remain in the portal flow.

External requests and results are temporary Redis records, independent of `users`, `game_links` and portal login. There is no automatic transfer of confirmation between a game's session and a portal account. Returning players can skip a new check when the game server already has its own saved confirmation.

### Campaign entry

`openAgeVerificationPopup()` forwards `utm_campaign` from the game's current URL to the popup start URL, unless the start URL already contains that parameter. The game server must pass it to Bridge with `createAgeVerificationRequest(callbackUrl, { utm_campaign: campaign })` or `create_age_verification_request(callback_url, utm_campaign=campaign)` (also available on the async Python client). Forward the parameter from the start request or saved entry context. Omit it when absent; an empty string still counts as present, matching the portal. With the parameter, the player confirms 18+ and skips Yoti. Without it, the regional policy applies. Adding a campaign to the Hooli popup URL later does not change the stored policy.
