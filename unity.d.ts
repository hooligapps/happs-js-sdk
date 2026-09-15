import type {
  HAppsClient,
  HAppsError,
  HAppsUnityBridge,
  HAppsUnityConfig,
  HAppsUnityInstance,
} from "./index";

export type {
  HAppsUnityBridge,
  HAppsUnityConfig,
  HAppsUnityInstance,
};

export interface HAppsUnityInputMap {
  init: Record<string, never>;
  connect: Record<string, never>;
  portal_auth: Record<string, never>;
  get_profile: Record<string, never>;
  open_payment: { orderId: string };
  open_external_url: { url: string };
  popup_auth: { url: string; callbackOrigin?: string };
  set_fullscreen: { enabled: boolean };
  set_theater_mode: { enabled: boolean };
  open_age_verification: { adultMode?: boolean };
}

export type HAppsUnityErrorMessage = {
  type: "error";
  error: HAppsError;
};

export declare function createUnityBridge(
  client: HAppsClient,
  config: HAppsUnityConfig,
): HAppsUnityBridge;
