# 4G dans le train — instructions projet

Carte communautaire **open source** de la couverture mobile (4G/5G) le long des
lignes de train en France. SvelteKit + Svelte 5 (runes) + TypeScript, carte
MapLibre, base libSQL (Drizzle), runtime **Bun**. Déployé en prod sur
https://4g-dans-le-train.juulieen.fr (serveur perso, Docker + Caddy).

## 📚 Documentation à tenir à jour — RÈGLE IMPORTANTE

Ce projet maintient sa propre documentation produit. **Tu DOIS la garder à jour
au fil de tes modifications**, sans attendre qu'on te le demande :

- **`docs/PRODUCT.md`** — contexte produit : à quoi sert le projet, comment
  fonctionnent les deux couches de données (ARCEP théorique + mesures
  communautaires), comment elles sont calculées, les décisions et conventions.
  👉 **Lis-le en début de tâche** pour comprendre le projet.
  👉 **Mets-le à jour** dès qu'une évolution change le comportement, le calcul
  des données, l'architecture ou une décision produit.
- **`docs/CHANGELOG.md`** — journal chronologique des évolutions.
  👉 **Ajoute une entrée** (date + résumé) pour toute évolution fonctionnelle ou
  de contenu notable que tu livres.
- **`docs/DATA.md`** — sources de données (SNCF, ARCEP) et pipelines d'import.
  👉 Mets-le à jour si tu changes un script `data:*` ou une source.
- **`docs/DEPLOY.md`** — procédure de déploiement.

Quand une modif et sa doc divergent, **corrige la doc dans le même commit**.
Si tu n'es pas sûr qu'une info mérite d'être documentée, demande-toi : « un
nouvel agent (ou Julien dans 3 mois) en aurait-il besoin pour comprendre ? » Si
oui, documente-la dans `docs/PRODUCT.md`.

## Commandes

```bash
bun run dev        # serveur de dev (http://localhost:5173)
bun run build      # build de prod (adapter-node)
bun run check      # typecheck (doit être à 0 erreur)
bun run lint       # prettier --check + eslint (doit être vert)
bun run format     # prettier --write
bun run data:sncf  # (ré)importe les tracés ferroviaires SNCF
bun run data:arcep # (ré)importe la couverture ARCEP puis régénère les voies
bun run db:migrate # applique les migrations libSQL
```

Avant de livrer : `bun run check && bun run lint && bun run build` doivent passer.

## Conventions

- **Svelte 5 runes** partout (`$state`, `$derived`, `$props`, `$effect`) — garde
  ce style, pas de syntaxe Svelte 4.
- **TypeScript strict**, CSS « maison » avec variables (pas de framework UI).
- Code et commentaires **en français** (UI et public cible francophones).
- **Vie privée non négociable** : aucune donnée perso, position toujours
  arrondie à la cellule H3 (~150 m) avant stockage, sessions anonymes. Ne
  jamais introduire de collecte ré-identifiante.
- **Tester le rendu navigateur via un sous-agent** (outils MCP Chrome), pas en
  direct — consigne du projet pour garder le contexte propre.
- **Ne déploie pas** sans validation : la prod tourne déjà et se met à jour
  depuis `main` (voir `docs/DEPLOY.md`).

## Carte d'orientation du code

- `src/routes/+page.svelte` — page carte (panneau : filtre opérateur, toggles,
  mode mesure, légende).
- `src/lib/components/Map.svelte` — carte MapLibre (couche ARCEP = voies
  colorées par usage, couche communautaire = pastilles, popups, légende).
- `src/lib/measure/` — mode mesure côté client (ping, geolocation, wakeLock,
  netinfo, session, controller).
- `src/lib/server/` — ingestion + accès DB (Drizzle/libSQL).
- `src/routes/api/{ping,measurements,coverage}/` — endpoints.
- `src/routes/{lignes,ligne/[slug],ligne/[slug]/[operateur],operateurs,operateur/[slug]}/`
  — pages SEO prerendues. Référentiel dans `src/lib/geo/lines.ts`.
- `scripts/` — imports de données (SNCF, ARCEP) et migrations.

```

```
