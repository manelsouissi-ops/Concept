# Diagnostic API Gemini

Date du diagnostic : 23 juillet 2026

## Portee

Diagnostic limite a :

- la configuration locale du projet Next.js ;
- la configuration du workflow n8n actif ;
- un test direct minimal contre l'API Gemini ;
- la verification de presence de la cle sans l'exposer.

Aucun CDC reel, aucun document projet et aucune donnee metier n'ont ete modifies.

## Emplacements de configuration identifies

### Next.js

- `.env.local`
  - contient `GEMINI_API_KEY` a titre de reference locale
  - contient aussi `N8N_WEBHOOK_URL`
- [lib/integrations/n8n-config.ts](/C:/Users/lotfi/Documents/Concept/lib/integrations/n8n-config.ts:1)
  - lit `N8N_WEBHOOK_URL`, `N8N_WEBHOOK_TOKEN`, `PLATFORM_CALLBACK_TOKEN`, `N8N_CALLBACK_SECRET`, `PLATFORM_PUBLIC_BASE_URL`
  - ne lit pas `GEMINI_API_KEY`
- [lib/appels-offres/analysis.ts](/C:/Users/lotfi/Documents/Concept/lib/appels-offres/analysis.ts:1)
  - envoie la requete de lancement vers n8n
  - ne lit pas `GEMINI_API_KEY`

Conclusion :

- le runtime Next.js ne consomme pas directement `GEMINI_API_KEY` pour appeler Gemini ;
- l'application delegue l'appel LLM a n8n.

### n8n

- workflow actif dans `C:\Users\lotfi\.n8n\database.sqlite`
  - workflow ID : `f866bd39869c4c11`
  - nom : `CDC Initiation - Fiche Projet XML`
- script local de demarrage :
  - [scripts/n8n-tests/start_n8n_canonical_test.cmd](/C:/Users/lotfi/Documents/Concept/scripts/n8n-tests/start_n8n_canonical_test.cmd:1)
  - contient seulement un placeholder :
    - `set "GEMINI_API_KEY=replace-with-gemini-api-key"`
- documentation :
  - [docs/n8n-canonical-contract-env.md](/C:/Users/lotfi/Documents/Concept/docs/n8n-canonical-contract-env.md:1)
  - indique explicitement que `GEMINI_API_KEY` appartient au runtime n8n

Conclusion :

- `.env.local` n'expose pas automatiquement la cle au process n8n ;
- le depot ne contient pas de script de demarrage n8n avec une vraie cle ;
- la valeur reelle doit etre injectee a n8n au lancement, hors des fichiers suivis par Git.

## Configuration Gemini trouvee dans le workflow actif

Noeud actif :

- `HTTP Request -> Gemini XML`

Configuration relevee :

- endpoint :
  - `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`
- type d'endpoint :
  - endpoint OpenAI-compatible de Google
- modele :
  - `gemini-3.6-flash`
- authentification :
  - header `Authorization`
  - format : `Bearer {{$env.GEMINI_API_KEY}}`
- autre header :
  - `Content-Type: application/json`
- format de body :
  - JSON avec `model`, `messages`, `max_tokens`

Conclusion :

- le workflow n8n n'utilise pas l'endpoint natif `generateContent` ;
- il utilise bien l'endpoint OpenAI-compatible Google ;
- aucune cle Gemini n'est hardcodee dans le workflow ;
- le workflow attend `GEMINI_API_KEY` dans l'environnement n8n via `$env` ;
- le workflow actif a ete mis a jour vers `gemini-3.6-flash` le 23 juillet 2026.

## Verification securisee de .env.local

Fichier :

- `C:\Users\lotfi\Documents\Concept\.env.local`

Verification :

- `.env.local` existe : oui
- `GEMINI_API_KEY` present : oui
- nombre de definitions : `1`
- valeur non vide : oui
- longueur : `53`
- valeur masquee : `AQ.A...5TsQ`
- guillemets autour de la valeur : non
- espaces parasites de debut/fin : non
- ligne mal formee detectee : non

## Verification d'exposition au runtime n8n

Constats locaux :

- variable `GEMINI_API_KEY` dans le shell courant : absente
- variable `GEMINI_API_KEY` en variable d'environnement utilisateur Windows : absente
- script `start_n8n_canonical_test.cmd` : placeholder uniquement

Inference raisonnable :

- la configuration du depot ne garantit pas a elle seule que n8n recoive la cle ;
- si le workflow n8n a deja atteint Google, alors une cle a bien ete injectee dans l'environnement du process n8n au moment de ce lancement ;
- cette injection provient d'un shell/session de demarrage ou d'une configuration externe, pas du code Next.js.

## Test direct minimal contre Gemini

Script cree :

- [scripts/test-gemini.mjs](/C:/Users/lotfi/Documents/Concept/scripts/test-gemini.mjs:1)

Comportement du script :

- charge `.env.local` via `dotenv`
- lit `GEMINI_API_KEY`
- masque la cle dans les logs
- appelle `GET /v1beta/models` avec `x-goog-api-key`
- liste les modeles supportant `generateContent`
- verifie d'abord que `models/gemini-3.6-flash` apparait dans `GET /models` avec `generateContent`
- appelle ensuite `POST /v1beta/models/gemini-3.6-flash:generateContent`
- appelle ensuite `POST /v1beta/openai/chat/completions` avec `model: gemini-3.6-flash`
- envoie uniquement `Reply only with OK`

### Resultat du test

Commande executee :

```powershell
npm run test:gemini
```

Resultat :

- `GET https://generativelanguage.googleapis.com/v1beta/models`
  - statut : `200 OK`
- verification du modele prefere
  - `models/gemini-3.6-flash` present : oui
  - `generateContent` supporte : oui
- `POST https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent`
  - statut : `200 OK`
  - texte retourne :
    - `OK`
- `POST https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`
  - statut : `200 OK`
  - texte retourne :
    - `OK`

Interpretation :

- la cle est bien acceptee ;
- l'API Gemini est joignable ;
- les endpoints natif et OpenAI-compatible fonctionnent tous les deux ;
- le blocage precedent etait lie au modele `gemini-2.5-flash`, devenu indisponible pour de nouveaux utilisateurs.

## Diagnostic final

Le diagnostic actuel est positif :

- l'acces Google fonctionne ;
- la cle fonctionne sur les deux endpoints testes ;
- le projet `gen-lang-client-0862723476` peut appeler la generation Gemini avec `gemini-3.6-flash` ;
- le probleme precedent venait du choix du modele `gemini-2.5-flash`, qui n'est plus disponible pour de nouveaux utilisateurs.

Le workflow n8n actif a donc ete aligne sur `gemini-3.6-flash`.

## Prochaines etapes exactes

1. Garder `gemini-3.6-flash` comme modele de reference tant qu'il reste disponible pour ce projet.
2. Conserver `GEMINI_API_KEY` injecte uniquement dans l'environnement n8n, jamais dans le workflow.
3. Reutiliser `npm run test:gemini` avant toute future rotation de modele.
4. Si un futur modele remplace `gemini-3.6-flash`, verifier d'abord `GET /models`, puis tester les endpoints natif et OpenAI-compatible avant toute modification du workflow.

## Fichiers modifies

- [package.json](/C:/Users/lotfi/Documents/Concept/package.json:1)
- [package-lock.json](/C:/Users/lotfi/Documents/Concept/package-lock.json:1)
- [scripts/test-gemini.mjs](/C:/Users/lotfi/Documents/Concept/scripts/test-gemini.mjs:1)
- [docs/gemini-api-diagnostic.md](/C:/Users/lotfi/Documents/Concept/docs/gemini-api-diagnostic.md:1)
- [tmp/patch_active_n8n_workflow_to_gemini.py](/C:/Users/lotfi/Documents/Concept/tmp/patch_active_n8n_workflow_to_gemini.py:1)
