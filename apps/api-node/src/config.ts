import { getConfig, type AppConfig } from '@akp/config';

export type { AppConfig } from '@akp/config';

/** Single entrypoint for configuration within the API process. */
export const config: AppConfig = getConfig();
