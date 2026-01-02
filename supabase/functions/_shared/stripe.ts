// Centralize the Stripe API version so every Edge Function stays on a stable, non-preview release.
export const STRIPE_API_VERSION = "2024-06-20";

type StripeConstructor<TStripe> = new (
  secretKey: string,
  config: { apiVersion: string; typescript?: boolean },
) => TStripe;

const stripeClients = new WeakMap<StripeConstructor<any>, Map<string, unknown>>();

export function getStripe<TStripe>(secretKey: string, StripeCtor: StripeConstructor<TStripe>): TStripe {
  let clientsByKey = stripeClients.get(StripeCtor);
  if (!clientsByKey) {
    clientsByKey = new Map<string, unknown>();
    stripeClients.set(StripeCtor, clientsByKey);
  }

  const existing = clientsByKey.get(secretKey) as TStripe | undefined;
  if (existing) return existing;

  const client = new StripeCtor(secretKey, {
    apiVersion: STRIPE_API_VERSION,
    typescript: true,
  });
  clientsByKey.set(secretKey, client);
  return client;
}
