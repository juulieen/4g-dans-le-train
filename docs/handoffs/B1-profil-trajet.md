# Handoff B1 — Vue « profil de trajet » (timeline de couverture)

## Lancement (worktree dédié)

```bash
cd /home/julien/devs/4g-dans-le-train
git worktree add .claude/worktrees/b1-profil -b feat/profil-trajet
# donner le PROMPT ci-dessous à un agent, cwd = .claude/worktrees/b1-profil
```

**Dépendances** : B1 est le plus dépendant. À lancer **après** A1 (snapping
ligne, indispensable pour rattacher la couverture à un parcours) et idéalement
après A2 (durées de coupure, pour la punchline « coupure 3 min »). Pars de la
branche qui contient déjà A1 (et A2 si possible), ou de `main` une fois ces
chantiers mergés. ⚠️ Touche l'UI → **coordonne avec la refonte « liquid glass »**
en cours (worktree `feat+ui-liquid-glass`) pour ne pas diverger sur le style.

---

## PROMPT POUR L'AGENT

Tu travailles sur **« 4G dans le train »** (SvelteKit + Svelte 5 + TS, MapLibre,
libSQL/Drizzle, Bun) : carte communautaire de couverture mobile dans le train.
Tu es dans le worktree `.claude/worktrees/b1-profil` sur `feat/profil-trajet`.

**Avant tout** : lis `CLAUDE.md` et `docs/PRODUCT.md`. Vérifie ce qui est
disponible : le snapping `lineSlug` (handoff A1) et les durées de coupure
(handoff A2) — `git log` des branches `feat/snapping-ligne` / `feat/duree-coupure`.

### L'opportunité

La promesse produit (`docs/PRODUCT.md`) — « sur mon trajet, à quel moment je
pourrai regarder une vidéo… ou rien ? » — n'est **pas tenue** : on n'a qu'une
carte. La carte répond à « où ? » mais mal à « **quand, sur MON trajet ?** ». Le
feature signature manquant est une **vue profil de trajet** : on choisit une
ligne (ex. Paris–Lyon) et on voit une **timeline linéaire gare→gare** colorée par
usage, qui dit concrètement « après [gare], ça coupe pendant ~3 min ».

### Ta mission

Créer une vue « profil de trajet » pour une ligne donnée : une **barre/frise
horizontale** (de la gare de départ à la gare d'arrivée) colorée par usage le
long du parcours, superposant **théorique (ARCEP)** et **réel (mesures)**, et
mettant en évidence les **coupures** (durée/longueur si A2 dispo) et les
**écarts** théorique↔réel.

### Approche recommandée

1. **Où l'afficher.** Deux options à arbitrer :
   - sur la page SEO `/ligne/[slug]` (excellent pour le SEO + cohérent avec B2) ;
   - et/ou dans l'app carte (`+page.svelte`) via un sélecteur de ligne qui ouvre
     le profil. Idéalement les deux partagent un **composant** réutilisable
     `src/lib/components/RouteProfile.svelte`.

2. **Données.** 
   - **ARCEP** : `static/data/arcep-lines.geojson` (segments par niveau) +
     l'index/tracé ligne produit par A1 → échantillonne le long du parcours
     ordonné (départ→arrivée) pour colorer la frise.
   - **Réel** : mesures rattachées via `lineSlug` (A1), agrégées par position le
     long de la ligne ; via `/api/coverage` (filtré par ligne) ou un endpoint
     dédié. Le réel se superpose et **prime** visuellement (ADN du projet).
   - **Coupures** : si A2 est dispo, place les épisodes (durée/longueur) sur la
     frise (« ✕ ~3 min »).
   - L'**ordre** des points le long de la ligne est clé (une frise est 1D) :
     c'est là qu'un vrai tracé ordonné (gares de passage) compte — vois ce que
     A1 / la branche GTFS `feat/lignes-commerciales-gtfs` fournit.

3. **Lisibilité / pédagogie.** Légende usage cohérente avec la carte
   (`USAGE_COLORS` dans `Map.svelte` : 🟢 streaming / 🟢 web / 🟠 messages / 🔴
   zone blanche). Marque les gares principales. Indicateur de confiance quand peu
   de mesures. Si possible, une estimation **temporelle** (vitesse commerciale
   moyenne → « à ~14h32 » est un bonus ; au minimum « après [gare], sur ~12 km »).

4. **Accessibilité.** La palette repose sur rouge↔vert (problématique daltonien) :
   ajoute un motif/forme ou des libellés, pas seulement la couleur.

### Contraintes

- Stack Bun / Svelte 5 runes / TS strict. `bun run check|lint|build`.
- **Coordination UI** : la refonte « liquid glass » mobile-first est en cours sur
  un autre worktree. Conçois `RouteProfile.svelte` proprement (props claires,
  styles encapsulés) pour qu'il s'intègre sans friction ; évite de remanier le
  layout global. Au besoin, aligne-toi sur les tokens de design (`+layout.svelte`
  `:global(:root)`).
- Mobile-first : la frise doit être lisible et scrollable au pouce.

### Définition de « terminé »

- Un composant `RouteProfile` affiche, pour une ligne, la frise théorique +
  réelle + coupures + écarts, lisible sur mobile et accessible.
- Intégré au moins sur `/ligne/[slug]` (et idéalement un sélecteur dans l'app).
- `check` + `lint` + `build` verts ; rendu vérifié via sous-agent Chrome (mobile
  + desktop). `docs/CHANGELOG.md` et `docs/PRODUCT.md` mis à jour.
- Pas de merge `main`, pas de déploiement. Récap final pour revue.

Pose des questions à Julien sur : où afficher le profil (SEO vs app vs les deux),
l'ampleur de l'estimation temporelle, et l'intégration avec le style en cours.
