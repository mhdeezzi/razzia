/** Le bookmaker fait partie du prix : deux services peuvent publier des offres différentes pour le même match. */
export function PriceSource({ provider, updated }: { provider?: string; updated?: string }) {
  if (!provider) return null;
  const at = updated && Number.isFinite(Date.parse(updated)) ? new Date(updated).toLocaleTimeString('fr-FR') : undefined;
  return <small className="price-source" title={at ? `${provider} · données de ${at}` : provider}>{provider}</small>;
}
