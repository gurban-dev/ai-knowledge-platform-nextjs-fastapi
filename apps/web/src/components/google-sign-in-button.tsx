'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { isGoogleAuthMessage } from '@/lib/google-auth-popup';

const ERROR_COPY = {
  google: 'Google sign-in could not be completed. Please try again.',
  google_unavailable:
    'Google sign-in could not start. Check that this site’s callback URL is allowed in Google Cloud and in CORS_ORIGINS / WEB_PUBLIC_URL, then restart the API.',
  popup_blocked:
    'Your browser blocked the Google sign-in window. Use “Continue in this tab” below, or allow popups for this site.',
  mfa_required: 'Additional verification is required.',
  cancelled: 'Google sign-in was cancelled.',
  network: 'Could not reach the auth server. Is the API running?',
} as const;

type ModalPhase = 'loading' | 'waiting' | 'blocked' | 'unavailable';

function oauthStartUrl(returnTo: string, popup: boolean): string {
  const params = new URLSearchParams({ returnTo });
  if (popup) params.set('popup', '1');
  return `/api/auth/google?${params.toString()}`;
}

function openCenteredPopup(url: string): Window | null {
  const width = 520;
  const height = 680;
  const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - width) / 2));
  const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - height) / 2));
  // Never set noopener — the popup must keep window.opener for postMessage.
  return window.open(
    url,
    'akp-google-oauth',
    `popup=yes,width=${width},height=${height},left=${left},top=${top}`,
  );
}

/**
 * Production Google sign-in control.
 *
 * - Always opens an in-page modal on click (visible feedback).
 * - Prefers a centered OAuth popup; falls back to same-tab redirect if blocked.
 * - Remains a real `<a href>` so sign-in still works if client JS fails to hydrate.
 */
export function GoogleSignInButton({
  label = 'Continue with Google',
  returnTo = '/login',
  successPath = '/app/chat',
}: {
  label?: string;
  returnTo?: string;
  successPath?: '/app/chat' | '/app/documents';
}): JSX.Element {
  const router = useRouter();
  const titleId = useId();
  const descriptionId = useId();
  const popupRef = useRef<Window | null>(null);
  const pollRef = useRef<number | null>(null);
  const completedRef = useRef(false);
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<ModalPhase>('loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const cleanup = useCallback(() => {
    if (pollRef.current != null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
    popupRef.current = null;
  }, []);

  const closeModal = useCallback(() => {
    try {
      popupRef.current?.close();
    } catch {
      // ignore
    }
    cleanup();
    setOpen(false);
    setPhase('loading');
  }, [cleanup]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (!isGoogleAuthMessage(event.data)) return;

      completedRef.current = true;
      cleanup();
      setOpen(false);
      setPhase('loading');

      const message = event.data;
      if (message.ok) {
        router.push(successPath);
        router.refresh();
        return;
      }

      if (message.error === 'mfa_required') {
        router.push('/login/mfa');
        return;
      }

      setError(ERROR_COPY[message.error]);
    };

    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
      if (pollRef.current != null) window.clearInterval(pollRef.current);
    };
  }, [cleanup, router, successPath]);

  const watchPopup = (popup: Window) => {
    popupRef.current = popup;
    if (pollRef.current != null) window.clearInterval(pollRef.current);
    pollRef.current = window.setInterval(() => {
      if (popupRef.current?.closed) {
        cleanup();
        // Prefer a real postMessage error over a false "cancelled" when the
        // bridge closes the popup immediately after notifying the opener.
        window.setTimeout(() => {
          if (!completedRef.current) {
            setOpen(false);
            setPhase('loading');
            setError((current) => current ?? ERROR_COPY.cancelled);
          }
        }, 250);
      }
    }, 400);
  };

  const launchPopup = () => {
    const popup = openCenteredPopup(oauthStartUrl(returnTo, true));
    if (!popup) {
      setPhase('blocked');
      return;
    }
    setPhase('waiting');
    popup.focus();
    watchPopup(popup);
  };

  const startGoogle = async () => {
    setError(null);
    completedRef.current = false;
    setOpen(true);
    setPhase('loading');

    try {
      const res = await fetch('/api/auth/google/config', { cache: 'no-store' });
      const config = (await res.json().catch(() => ({}))) as {
        enabled?: boolean;
        clientId?: string | null;
      };

      if (!config.enabled || !config.clientId) {
        setPhase('unavailable');
        setError(ERROR_COPY.google_unavailable);
        return;
      }

      launchPopup();
    } catch {
      setPhase('unavailable');
      setError(ERROR_COPY.network);
    }
  };

  const modal =
    mounted && open
      ? createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-6"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            onClick={(event) => {
              if (event.target === event.currentTarget) {
                closeModal();
                if (!completedRef.current) setError(ERROR_COPY.cancelled);
              }
            }}
          >
            <div className="w-full max-w-md rounded-lg border border-ink/10 bg-white p-6 shadow-2xl">
              <h2 id={titleId} className="font-display text-2xl text-ink">
                Sign in with Google
              </h2>
              <p id={descriptionId} className="mt-3 text-sm leading-relaxed text-ink/70">
                {phase === 'loading'
                  ? 'Checking Google sign-in…'
                  : phase === 'waiting'
                    ? 'Complete sign-in in the Google window. This dialog closes automatically when you are done.'
                    : phase === 'blocked'
                      ? 'Complete Google sign-in in this tab. You will return here after authorizing.'
                      : 'Google sign-in is not available until OAuth credentials are configured on the server.'}
              </p>

              {phase === 'loading' || phase === 'waiting' ? (
                <div className="mt-6 flex items-center gap-3 text-sm text-ink/60">
                  <span
                    className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-ink/15 border-t-accent"
                    aria-hidden="true"
                  />
                  {phase === 'loading' ? 'Preparing…' : 'Waiting for Google…'}
                </div>
              ) : null}

              {phase === 'blocked' ? (
                <a
                  href={oauthStartUrl(returnTo, false)}
                  className="mt-6 flex w-full items-center justify-center gap-3 rounded-md bg-accent px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-95"
                >
                  <GoogleLogo />
                  Continue in this tab
                </a>
              ) : null}

              {phase === 'unavailable' && error ? (
                <p role="alert" className="mt-4 text-sm text-red-700">
                  {error}
                </p>
              ) : null}

              <div className="mt-6 flex gap-3">
                {phase === 'waiting' ? (
                  <button
                    type="button"
                    className="flex-1 rounded-md border border-ink/15 px-4 py-2 text-sm font-medium text-ink hover:bg-ink/5"
                    onClick={launchPopup}
                  >
                    Reopen Google window
                  </button>
                ) : null}
                <button
                  type="button"
                  className="flex-1 rounded-md border border-ink/15 px-4 py-2 text-sm font-medium text-ink hover:bg-ink/5"
                  onClick={() => {
                    closeModal();
                    if (!completedRef.current && phase !== 'unavailable') {
                      setError(ERROR_COPY.cancelled);
                    }
                  }}
                >
                  {phase === 'unavailable' ? 'Close' : 'Cancel'}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <div className="mt-6">
      <div className="flex items-center" aria-hidden="true">
        <div className="flex-grow border-t border-ink/10" />
        <span className="mx-3 text-xs uppercase tracking-wide text-ink/50">or</span>
        <div className="flex-grow border-t border-ink/10" />
      </div>

      <a
        href={oauthStartUrl(returnTo, false)}
        onClick={(event) => {
          event.preventDefault();
          void startGoogle();
        }}
        className="mt-6 flex w-full items-center justify-center gap-3 rounded-md border border-ink/15 bg-white px-4 py-2.5 text-sm font-semibold text-ink transition hover:bg-ink/5"
      >
        <GoogleLogo />
        {label}
      </a>

      {error && !open ? (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {modal}
    </div>
  );
}

function GoogleLogo(): JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.997 8.997 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.168 6.656 3.58 9 3.58z"
      />
    </svg>
  );
}
