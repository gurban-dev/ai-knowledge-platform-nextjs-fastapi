import { ErrorCode, UnauthorizedError } from '@akp/core';

/** Access token is well-formed but past its expiry. Clients should refresh. */
export class TokenExpiredError extends UnauthorizedError {
  constructor(message = 'Access token has expired') {
    super(message, ErrorCode.TOKEN_EXPIRED);
  }
}

/** Access token is malformed, tampered, or otherwise unverifiable. */
export class TokenInvalidError extends UnauthorizedError {
  constructor(message = 'Access token is invalid') {
    super(message, ErrorCode.TOKEN_INVALID);
  }
}

/** Credentials did not match a known user. Deliberately vague to avoid enumeration. */
export class InvalidCredentialsError extends UnauthorizedError {
  constructor(message = 'Invalid email or password') {
    super(message, ErrorCode.INVALID_CREDENTIALS);
  }
}
