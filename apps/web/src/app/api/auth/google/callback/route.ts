import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { API_URL } from '@/lib/api';
import { setAuthCookies } from '@/lib/auth-cookies';
import { googlePopupBridgeHtml } from '@/lib/google-auth-popup';
import { getPublicOrigin } from '@/lib/request-origin';

const STATE_COOKIE = 'akp_oauth_state';
const RETURN_COOKIE = 'akp_oauth_return';
const POPUP_COOKIE = 'akp_oauth_popup';
const MFA_COOKIE = 'akp_mfa_pending';

interface ExchangeSuccess {
  tokens: {
    accessToken: string;
    refreshToken: string;
  };
}

interface ExchangeError {
  error?: {
    code?: string;
    details?: {
      mfaToken?: string;
    };
  };
}

function clearOauthCookies(response: NextResponse): void {
  response.cookies.delete(STATE_COOKIE);
  response.cookies.delete(RETURN_COOKIE);
  response.cookies.delete(POPUP_COOKIE);
}

function popupResponse(origin: string, message: Parameters<typeof googlePopupBridgeHtml>[1]) {
  return new NextResponse(googlePopupBridgeHtml(origin, message), {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

function cookieSecure(origin: string): boolean {
  return origin.startsWith('https://') || process.env.NODE_ENV === 'production';
}

/**
 * Google redirects here with `?code&state`. In popup mode we set session cookies
 * then notify the opener via postMessage and close the window. In full-page mode
 * we redirect into the app as before.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const origin = getPublicOrigin(request);
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const oauthError = url.searchParams.get('error');
  const secure = cookieSecure(origin);

  const cookieStore = cookies();
  const expectedState = cookieStore.get(STATE_COOKIE)?.value;
  const returnTo = cookieStore.get(RETURN_COOKIE)?.value ?? '/login';
  const isPopup = cookieStore.get(POPUP_COOKIE)?.value === '1';

  const fail = (reason: 'google' | 'google_unavailable'): NextResponse => {
    if (isPopup) {
      const response = popupResponse(origin, {
        type: 'akp-google-auth',
        ok: false,
        error: reason,
      });
      clearOauthCookies(response);
      return response;
    }
    const res = NextResponse.redirect(`${origin}${returnTo}?error=${reason}`);
    clearOauthCookies(res);
    return res;
  };

  if (oauthError || !code || !state || !expectedState || state !== expectedState) {
    return fail('google');
  }

  const redirectUri = `${origin}/api/auth/google/callback`;
  const res = await fetch(`${API_URL}/v1/auth/google/exchange`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, redirectUri, state }),
  });

  const data = (await res.json().catch(() => ({}))) as ExchangeSuccess | ExchangeError;

  if (res.status === 401 && 'error' in data && data.error?.code === 'MFA_REQUIRED') {
    const mfaToken = data.error.details?.mfaToken;
    if (!mfaToken) return fail('google');

    if (isPopup) {
      const response = popupResponse(origin, {
        type: 'akp-google-auth',
        ok: false,
        error: 'mfa_required',
      });
      clearOauthCookies(response);
      response.cookies.set(MFA_COOKIE, mfaToken, {
        httpOnly: true,
        sameSite: 'lax',
        secure,
        path: '/',
        maxAge: 60 * 5,
      });
      return response;
    }

    const response = NextResponse.redirect(`${origin}/login/mfa`);
    clearOauthCookies(response);
    response.cookies.set(MFA_COOKIE, mfaToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure,
      path: '/',
      maxAge: 60 * 5,
    });
    return response;
  }

  if (!res.ok || !('tokens' in data) || !data.tokens) {
    return fail('google');
  }

  if (isPopup) {
    const response = popupResponse(origin, {
      type: 'akp-google-auth',
      ok: true,
      next: '/app/chat',
    });
    clearOauthCookies(response);
    setAuthCookies(response, data.tokens);
    return response;
  }

  const response = NextResponse.redirect(`${origin}/app/chat`);
  clearOauthCookies(response);
  setAuthCookies(response, data.tokens);
  return response;
}
