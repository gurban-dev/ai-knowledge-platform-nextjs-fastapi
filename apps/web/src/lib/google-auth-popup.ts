/**
 * Shared contract between the Google OAuth popup callback and the opener page.
 * Kept in a plain module so both the client button and the callback HTML use
 * the same type discriminator.
 */
export const GOOGLE_AUTH_MESSAGE_TYPE = 'akp-google-auth' as const;

export type GoogleAuthMessage =
  | { type: typeof GOOGLE_AUTH_MESSAGE_TYPE; ok: true; next?: string }
  | {
      type: typeof GOOGLE_AUTH_MESSAGE_TYPE;
      ok: false;
      error: 'google' | 'google_unavailable' | 'popup_blocked' | 'mfa_required';
    };

export function isGoogleAuthMessage(data: unknown): data is GoogleAuthMessage {
  if (!data || typeof data !== 'object') return false;
  const msg = data as { type?: unknown; ok?: unknown };
  return msg.type === GOOGLE_AUTH_MESSAGE_TYPE && typeof msg.ok === 'boolean';
}

/** Build a tiny HTML page that notifies the opener and closes the popup. */
export function googlePopupBridgeHtml(origin: string, message: GoogleAuthMessage): string {
  const payload = JSON.stringify(message).replace(/</g, '\\u003c');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Google sign-in</title>
  <style>
    body { font-family: system-ui, sans-serif; display: grid; place-items: center; min-height: 100vh; margin: 0; color: #1a1a1a; background: #f7f5f0; }
    p { font-size: 14px; opacity: 0.7; }
  </style>
</head>
<body>
  <p>Finishing sign-in…</p>
  <script>
    (function () {
      var message = ${payload};
      try {
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage(message, ${JSON.stringify(origin)});
        }
      } catch (e) {}
      // Delay close so the opener can handle postMessage before the window dies.
      setTimeout(function () {
        window.close();
        document.body.innerHTML = '<p>You can close this window and return to the app.</p>';
      }, 100);
    })();
  </script>
</body>
</html>`;
}
