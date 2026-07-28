import { NextResponse } from 'next/server';
import { API_URL } from '@/lib/api';
import { googlePopupBridgeHtml } from '@/lib/google-auth-popup';
import { getPublicOrigin } from '@/lib/request-origin';

const STATE_COOKIE = 'akp_oauth_state';
const RETURN_COOKIE = 'akp_oauth_return';
const POPUP_COOKIE = 'akp_oauth_popup';

interface GoogleStartResponse {
  authorizationUrl: string;
  state: string;
}

function safeReturnTo(raw: string | null, origin: string): string {
  if (!raw) return '/login';
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/login';
  try {
    const url = new URL(raw, origin);
    if (url.origin !== origin) return '/login';
    return `${url.pathname}${url.search}`;
  } catch {
    return '/login';
  }
}

function cookieOptions(secure: boolean, maxAge = 60 * 10) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure,
    path: '/',
    maxAge,
  };
}

/**
 * Begin Google OAuth. Supports both full-page and popup modes (`?popup=1`).
 * Popup mode is used by the "Sign up with Google" button so the Google account
 * chooser opens in a centered window instead of navigating the main page away.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const origin = getPublicOrigin(request);
  const requestUrl = new URL(request.url);
  const returnTo = safeReturnTo(requestUrl.searchParams.get('returnTo'), origin);
  const popup = requestUrl.searchParams.get('popup') === '1';
  const redirectUri = `${origin}/api/auth/google/callback`;
  const secure = origin.startsWith('https://');

  const res = await fetch(
    `${API_URL}/v1/auth/google/start?redirectUri=${encodeURIComponent(redirectUri)}`,
    { cache: 'no-store' },
  );

  if (!res.ok) {
    if (popup) {
      return new NextResponse(
        googlePopupBridgeHtml(origin, {
          type: 'akp-google-auth',
          ok: false,
          error: 'google_unavailable',
        }),
        { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } },
      );
    }
    return NextResponse.redirect(`${origin}${returnTo}?error=google_unavailable`);
  }

  const data = (await res.json()) as GoogleStartResponse;
  const response = NextResponse.redirect(data.authorizationUrl);
  response.cookies.set(STATE_COOKIE, data.state, cookieOptions(secure));
  response.cookies.set(RETURN_COOKIE, returnTo, cookieOptions(secure));
  if (popup) {
    response.cookies.set(POPUP_COOKIE, '1', cookieOptions(secure));
  } else {
    response.cookies.delete(POPUP_COOKIE);
  }
  return response;
}
