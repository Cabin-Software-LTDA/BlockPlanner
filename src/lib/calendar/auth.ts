// OAuth credentials exist only inside this module's memory, never in IndexedDB or logs.
export const scopes = [
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.events.readonly",
];
interface TokenResponse {
  access_token?: string;
  expires_in: number;
  scope?: string;
  error?: string;
}
interface GoogleIdentity {
  accounts: {
    oauth2: {
      initTokenClient(config: {
        client_id: string;
        scope: string;
        include_granted_scopes: boolean;
        callback: (result: TokenResponse) => void;
        error_callback: () => void;
      }): { requestAccessToken(options: { prompt: string }): void };
      revoke(
        token: string,
        callback: (result: { successful: boolean }) => void,
      ): void;
    };
  };
}
let identity: GoogleIdentity | undefined;
let loading: Promise<void> | undefined;
let credential: { token: string; expires: number } | undefined;
let generation = 0;
export function accessToken() {
  if (credential && credential.expires > Date.now() + 30000)
    return credential.token;
  credential = undefined;
  return undefined;
}
export function clearToken() {
  generation++;
  credential = undefined;
}
export function loadIdentity() {
  if (identity) return Promise.resolve();
  if (loading) return loading;
  loading = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    const timeout = setTimeout(() => fail(), 15000);
    function fail() {
      clearTimeout(timeout);
      script.remove();
      loading = undefined;
      reject(
        new Error(
          "Google sign-in could not load. Check your connection and retry.",
        ),
      );
    }
    script.onerror = fail;
    script.onload = () => {
      clearTimeout(timeout);
      identity = (window as unknown as { google?: GoogleIdentity }).google;
      if (!identity) {
        fail();
        return;
      }
      resolve();
    };
    document.head.append(script);
  });
  return loading;
}
// Call synchronously from a button after loadIdentity, preserving popup user activation.
export function authorize(clientId: string): Promise<string> {
  const current = ++generation;
  return new Promise((resolve, reject) => {
    if (!identity) {
      reject(new Error("Load Google sign-in first."));
      return;
    }
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      if (current === generation) clearToken();
      reject(
        new Error(
          "Google sign-in timed out. Try again in a browser that allows popups.",
        ),
      );
    }, 90000);
    const client = identity.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: scopes.join(" "),
      include_granted_scopes: false,
      callback: (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (current !== generation) {
          reject(new Error("Authorization was cancelled."));
          return;
        }
        if (
          result.error ||
          !result.access_token ||
          !Number.isFinite(Number(result.expires_in)) ||
          Number(result.expires_in) <= 30 ||
          !scopes.every((scope) => result.scope?.split(" ").includes(scope))
        ) {
          reject(
            new Error(
              "Both read-only permissions are needed. Reconnect and grant calendar list and event access.",
            ),
          );
          return;
        }
        credential = {
          token: result.access_token,
          expires: Date.now() + Number(result.expires_in) * 1000,
        };
        resolve(credential.token);
      },
      error_callback: () => {
        settled = true;
        clearTimeout(timer);
        reject(
          new Error(
            "Google sign-in was closed or blocked. Allow the popup and try again.",
          ),
        );
      },
    });
    client.requestAccessToken({ prompt: "select_account" });
  });
}
export async function revokeAccess() {
  const token = accessToken();
  clearToken();
  if (!token || !identity) return false;
  const google = identity;
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), 8000);
    google.accounts.oauth2.revoke(token, (result) => {
      clearTimeout(timer);
      resolve(result.successful);
    });
  });
}
