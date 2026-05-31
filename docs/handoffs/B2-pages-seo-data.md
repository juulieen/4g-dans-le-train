# Handoff B2 — Remplir les pages SEO avec de vraies données

## Lancement (worktree dédié)

```bash
cd /home/julien/devs/4g-dans-le-train
git worktree add .claude/worktrees/b2-seo-data -b feat/seo-data
# donner le PROMPT ci-dessous à un agent, cwd = .claude/worktrees/b2-seo-data
```

**Dépendances** : la partie **ARCEP** (couverture théorique) ne dépend de rien,
fais-la d'abord — c'est un gain immédiat. La partie **mesures réelles** dépend du
snapping `lineSlug` (handoff A1) ; si A1 n'est pas encore mergé, conçois les
emplacements et reviens les remplir, ou pars de la branche d'A1.

---

## PROMPT POUR L'AGENT

Tu travailles sur **« 4G dans le train »** (SvelteKit + Svelte 5 + TS, MapLibre,
libSQL/Drizzle, Bun) : carte communautaire de couverture mobile dans le train.
Tu es dans le worktree `.claude/worktrees/b2-seo-data` sur `feat/seo-data`.

**Avant tout** : lis `CLAUDE.md` et `docs/PRODUCT.md`.

### Le problème

Le projet a **67 pages prerendues** pour le SEO — `/ligne/[slug]`,
`/operateur/[slug]`, et 48 croisées `/ligne/[slug]/[operateur]` — mais elles ne
contiennent **aucune donnée réelle**. Leurs loaders (`+page.ts`) ne chargent que
le référentiel statique de `src/lib/geo/lines.ts` (slugs, villes). Ce sont des
coquilles : ni chiffre ARCEP, ni mesure communautaire, ni le moindre fait unique.
Double gâchis :

- **SEO** : Google récompense le contenu unique et factuel ; des pages
  quasi-identiques sans données se positionnent mal.
- **Produit** : l'ADN du projet (révéler les **écarts** entre couverture
  _annoncée_ par les opérateurs et couverture _réelle_) n'apparaît nulle part en
  texte indexable.

### Ta mission

Injecter dans ces pages des **données réelles calculées au build (prerender)** :

1. **Côté ARCEP (sans dépendance, à faire en premier).** La donnée existe déjà
   dans `static/data/arcep-lines.geojson` (segments de voie portant le niveau
   `orange/sfr/free/bouygues` + `best`, produit par
   `scripts/build-arcep-lines.ts`). Mais ce fichier couvre tout le réseau RFN,
   pas « la ligne Paris–Lyon » identifiée. Tu as besoin de **rattacher les
   segments ARCEP à chaque ligne commerciale** (`RAIL_LINES`). Idéalement,
   réutilise l'index ligne produit par le handoff **A1** (cellule H3 → slug). À
   défaut, génère un résumé par ligne dans un script
   `scripts/build-line-stats.ts` produisant un JSON
   `static/data/line-stats.json` du type :

   ```
   { "paris-lyon": {
       "arcep": { "orange": {"TBC": 0.78, "BC": 0.15, "CL": 0.04, "none": 0.03}, ... },
       "best":  {"TBC": 0.85, ...},
       "zonesBlanches": 3
   }, ... }
   ```

   Les loaders `+page.ts` lisent ce JSON (au build, donc zéro coût runtime).

2. **Côté réel (dépend d'A1).** Si `lineSlug` est renseigné (handoff A1) et qu'il
   y a des mesures, ajoute un résumé communautaire par ligne/opérateur (taux de
   réussite réel, nb de mesures, fraîcheur) et surtout la **comparaison** : « Free
   annonce une bonne couverture sur 80 % du trajet ; les voyageurs constatent
   X % ». ⚠️ Les mesures évoluent : sur des pages prerendues, soit tu régénères
   au build périodiquement, soit tu charges ce bloc dynamiquement côté client
   (fetch `/api/coverage?line=…`) — **propose le bon compromis** (prerender pour
   l'ARCEP stable, hydratation client légère pour le réel mouvant).

3. **Rédige le contenu** : transforme ces chiffres en phrases naturelles et
   utiles (pas un dump de JSON). Ex. « Sur Paris–Lyon, la 4G Orange est annoncée
   excellente sur 78 % du parcours, avec 3 zones blanches connues, notamment
   après [ville]. » Mets à jour les `<meta description>` pour qu'elles incluent
   un chiffre saillant (booste le CTR). Garde le JSON-LD FAQ existant, enrichis-le
   avec les vrais chiffres.

### Contraintes

- Stack Bun / Svelte 5 runes / TS strict. Les pages SEO sont **prerendues**
  (`export const prerender = true`) — tout calcul lourd doit se faire au build
  (dans `entries`/`load` ou un script `data:*`), pas au runtime.
- Fichiers concernés : `src/routes/ligne/[slug]/+page.{ts,svelte}`,
  `src/routes/ligne/[slug]/[operateur]/+page.{ts,svelte}`,
  `src/routes/operateur/[slug]/+page.{ts,svelte}`, `src/lib/geo/lines.ts`,
  nouveau script `scripts/build-line-stats.ts` + entrée dans `package.json`.
- Ne casse pas le sitemap (`src/routes/sitemap.xml/+server.ts`) ni le maillage
  interne existant.
- Reste sobre côté style (refonte UI gérée ailleurs) — concentre-toi sur le
  **contenu et les données**, pas l'esthétique.

### Définition de « terminé »

- Chaque page ligne / opérateur / croisée affiche des chiffres ARCEP réels et un
  texte unique et utile ; comparaison théorique/réel présente là où des mesures
  existent.
- Un script reproductible génère les stats (documenté dans `docs/DATA.md`).
- `check` + `lint` + `build` verts (le build prerend les 67 pages sans erreur) ;
  vérifie quelques pages via un sous-agent Chrome. `docs/CHANGELOG.md` mis à jour.
- Pas de merge `main`, pas de déploiement. Récap final pour revue.

Pose des questions à Julien sur : prerender vs hydratation client pour le bloc
« réel » mouvant, et le niveau de détail rédactionnel souhaité.
