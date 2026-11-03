// Provider registry. The dispatcher looks a provider up by name; intent
// kinds map to providers in lib/dispatch/kinds.ts.

import { makeEmailProvider } from "./email.ts";
import { makeSmsProvider } from "./sms.ts";
import { makeTelegramProvider } from "./telegram.ts";
import { makeVoiceProvider } from "./voice.ts";
import type { Provider } from "./types.ts";

export type ProviderName = "email" | "sms" | "voice" | "telegram";

export type ProviderRegistry = Record<ProviderName, Provider<Record<string, unknown>>>;

export function defaultProviders(): ProviderRegistry {
  return {
    email: makeEmailProvider() as Provider<Record<string, unknown>>,
    sms: makeSmsProvider() as Provider<Record<string, unknown>>,
    voice: makeVoiceProvider() as Provider<Record<string, unknown>>,
    telegram: makeTelegramProvider() as Provider<Record<string, unknown>>,
  };
}

export * from "./types.ts";
