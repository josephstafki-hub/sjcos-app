/** A simulated check, or a check from another environment, proves no readiness. */
export function squareReadiness(environment: string, config: {
  connection_state: string; environment: string; capabilities: Record<string, unknown>;
} | null) {
  const verified = environment !== 'fake' && config?.environment === environment && config?.capabilities.adapter === environment;
  const connected = !!verified && config?.connection_state === 'connected';
  return { connected, state: connected ? 'connected' : environment === 'fake' ? 'unconfigured' : config?.connection_state === 'error' ? 'error' : 'configured', capabilities: connected ? config!.capabilities : {} };
}
