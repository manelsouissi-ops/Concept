export function toErrorMessage(value: unknown) {
  return typeof value === "string" ? value : "";
}

function includesTechnicalMarker(message: string) {
  const normalized = message.toLowerCase();
  return [
    "n8n_webhook_token",
    "platform_callback_token",
    "n8n_callback_secret",
    "gemini_api_key",
    "webhook n8n",
    "contrat n8n",
    "callback_url",
    "impossible de contacter le webhook",
    "delai autorise",
    "contract_version"
  ].some((marker) => normalized.includes(marker));
}

export function toBusinessSafeAnalysisError(message: string) {
  if (!message.trim()) {
    return "L'analyse n'a pas pu etre demarree. Le dossier peut etre conserve et relance depuis son espace de travail.";
  }

  if (includesTechnicalMarker(message)) {
    return "L'analyse n'a pas pu etre demarree. Le dossier peut etre conserve et relance depuis son espace de travail.";
  }

  return message;
}
