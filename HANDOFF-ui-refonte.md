# Handoff — Refonte UI « liquid glass », mobile-first + onboarding

> Ce fichier est un **prompt de handoff autonome**. Copie tout le bloc « PROMPT POUR
> L'AGENT » ci-dessous et donne-le à un nouvel agent (idéalement lancé dans une
> **branche dédiée**). Il contient tout le contexte nécessaire : l'agent n'a pas
> besoin de connaître l'historique de la conversation.

---

## Comment lancer (côté Julien)

```bash
cd /home/julien/devs/4g-dans-le-train
git checkout -b feat/ui-liquid-glass
# puis donner le PROMPT ci-dessous à un nouvel agent
```

Le projet est **déployé en production** sur https://4g-dans-le-train.juulieen.fr
(serveur perso asus-1, via Tailscale + Docker + Caddy). **Ne pas déployer depuis
cette branche** : on merge sur `main` après revue, et c'est `main` qui déploie.

---

## PROMPT POUR L'AGENT

Tu travailles sur **« 4G dans le train »**, une web-app SvelteKit open source :
une carte communautaire de la couverture mobile (4G/5G) le long des lignes de
train en France. Le projet est dans `/home/julien/devs/4g-dans-le-train`, tu es
sur la branche `feat/ui-liquid-glass`.

### Ta mission

Refondre **le look & feel** pour une UI **nettement plus moderne**, esthétique
« **liquid glass** » (glassmorphism : surfaces translucides, flou d'arrière-plan,
reflets, profondeur, micro-animations douces), **optimisée mobile-first** (la
cible principale = quelqu'un dans le train sur son téléphone). Tu ajoutes aussi
un **onboarding pédagogique** qui explique le principe du projet et **comment les
données sont calculées**.

**Périmètre : présentation uniquement.** Ne change PAS la logique métier
(mesure GPS/ping, ingestion, binning H3, API, structure des données, génération
des pages SEO). Tu touches au CSS, aux composants de présentation, à la mise en
page, et tu ajoutes des composants d'onboarding. Si tu dois ajuster un peu de
markup pour le style, c'est OK, mais ne casse aucune fonctionnalité existante.

### Contexte produit (à respecter, c'est l'âme du projet)

La carte superpose **deux couches** dont la distinction est essentielle :

1. **Couverture ARCEP (théorique)** — la voie ferrée est **colorée** selon ce
   qu'on peut y faire. C'est la couverture _officielle annoncée_ par les
   opérateurs (régulateur télécom ARCEP).
2. **Mesures communautaires (réel)** — des **pastilles vives cerclées de blanc**,
   posées par-dessus. C'est le _vécu réel_ des voyageurs. **Le réel prime
   visuellement sur le théorique** : tout l'intérêt du projet est de révéler les
   écarts entre la promesse opérateur et la réalité du train.

Code couleur par **usage** (déjà en place, à conserver / sublimer) :

- 🟢 vert `#22c55e` → streaming vidéo, visio (niveau ARCEP « TBC »)
- 🟢 vert-clair `#84cc16` → web, réseaux sociaux (« BC »)
- 🟠 orange `#f59e0b` → messages seulement (« CL »)
- 🔴 rouge `#ef4444` → zone blanche, rien

### Onboarding à créer

Un parcours d'accueil (modale/bottom-sheet glassy, ou écrans glissables —
mobile-first), affiché au premier passage (mémorisé en `localStorage`),
ré-ouvrable via un bouton « ℹ️ / Comment ça marche ». Il explique :

1. **Le principe** : « Dans le train, sachez à l'avance où vous pourrez regarder
   une vidéo, faire une recherche… ou rien du tout. »
2. **Comment lire la carte** : voie colorée = théorique (ARCEP) ; pastilles
   cerclées de blanc = mesuré en vrai par la communauté.
3. **D'où viennent les données ARCEP** : couverture théorique officielle publiée
   par l'ARCEP (le régulateur), par opérateur et par technologie. On la projette
   le long des voies ferrées et on la traduit en usages concrets (streaming /
   web / messages / zone blanche). C'est une _prévision_, pas une garantie.
4. **Comment sont calculées les mesures communautaires (les nôtres)** : quand un
   voyageur active le « mode mesure », l'app teste la connexion en continu (un
   petit _ping_ réseau → ça passe / c'est lent / ça coupe) + sa position GPS.
   **Vie privée** : la position est **arrondie à ~150 m** (cellules H3) avant
   tout envoi, **aucune donnée personnelle**, aucune trace continue
   ré-identifiable. Les mesures sont **agrégées par zone et par opérateur**
   (taux de réussite, latence médiane).
5. **Appel à contribuer** : « Prenez le train, activez le mode mesure, enrichissez
   la carte pour tout le monde. » + rappel que c'est open source.

Soigne la **pédagogie visuelle** (petits schémas, icônes, exemples concrets type
« Paris 🟢🟢🟡🟢🔴🟠🟢 Lyon »). Le ton est clair, accessible, un peu fun.

### Stack & contraintes techniques

- **SvelteKit 2 + Svelte 5** (runes : `$state`, `$derived`, `$props`,
  `$effect` — déjà utilisées partout, garde ce style).
- **TypeScript strict**, **Vite**, build via **Bun** (`bun run dev`,
  `bun run build`, `bun run check`, `bun run lint`, `bun run format`).
- Carte : **MapLibre GL JS** (`src/lib/components/Map.svelte`). Le style de carte
  actuel est `https://demotiles.maplibre.org/style.json` (basique). **Tu peux
  proposer un fond de carte plus élégant** (ex. un style sombre/clair cohérent
  avec le thème) à condition qu'il reste **gratuit et sans clé API** (ou alors
  documente clairement toute clé requise via variable d'env — n'en commite
  jamais). Si tu n'es pas sûr, garde demotiles mais améliore tout autour.
- **PWA** déjà configurée (`@vite-pwa/sveltekit`). ⚠️ En dev, un Service Worker
  peut mettre en cache et te servir une vieille version (page blanche) : si ça
  arrive, dans la console du navigateur fais
  `navigator.serviceWorker.getRegistrations().then(rs=>rs.forEach(r=>r.unregister())); caches.keys().then(ks=>ks.forEach(k=>caches.delete(k)));`
  puis recharge.
- **Pas de grosse dépendance UI** (pas de Tailwind/Material/etc. sauf si tu
  juges que ça vaut vraiment le coup — dans ce cas, justifie). Le projet est en
  CSS « maison » avec des variables. Privilégie du CSS moderne natif
  (backdrop-filter, color-mix, container queries, @starting-style, view
  transitions…) — c'est parfait pour un effet liquid glass léger.
- Il existe peut-être un skill **`frontend-design`** : utilise-le si pertinent
  pour la qualité visuelle.

### Tokens de design actuels (dans `src/routes/+layout.svelte`, `:global(:root)`)

```css
--bg: #0b1220;
--panel: #131c2e;
--accent: #22c55e;
--text: #e2e8f0;
--muted: #94a3b8;
--border: #1e293b;
```

Thème **sombre** actuellement. Tu peux faire évoluer la palette (garde une bonne
cohérence avec le code couleur usage vert/jaune/orange/rouge qui est
sémantique). Pense **contraste/accessibilité** (les popups avaient justement un
bug de lisibilité corrigé récemment : texte clair sur fond sombre).

### Fichiers / structure

```
src/routes/
  +layout.svelte            ← header, nav, footer, variables CSS globales, styles body
  +page.svelte              ← page carte (panneau latéral : filtre opérateur,
                              toggles de couches, mode mesure, légende)
  lignes/+page.svelte       ← liste des lignes
  ligne/[slug]/+page.svelte ← page SEO d'une ligne
  ligne/[slug]/[operateur]/+page.svelte ← page SEO croisée ligne×opérateur
  operateurs/+page.svelte   ← liste des opérateurs
  operateur/[slug]/+page.svelte ← page SEO d'un opérateur
  faq/+page.svelte
  confidentialite/+page.svelte
src/lib/components/Map.svelte ← carte MapLibre (couches ARCEP voies + communautaire,
                                popups, légende overlay)
```

Le **panneau latéral** de `+page.svelte` en desktop devrait devenir, sur mobile,
quelque chose d'ergonomique (bottom-sheet glassy rétractable, ou onglets) pour
laisser la carte respirer en plein écran. C'est un point clé du mobile-first.

### Données de test (pour voir des couleurs variées en dev)

Les fichiers `static/data/arcep-lines.geojson` (voies colorées) et
`static/data/rail-lines.geojson` (tracés) sont versionnés et présents : la carte
s'affiche dès `bun run dev` sans rien importer. Il peut y avoir 0 ou quelques
mesures communautaires en base locale — c'est normal, concentre-toi sur le rendu
des deux couches et de l'onboarding.

### Méthode de travail attendue

0. **Lis `CLAUDE.md` et `docs/PRODUCT.md`** (contexte produit, source de vérité)
   avant de commencer, et **tiens la doc à jour** : ajoute une entrée à
   `docs/CHANGELOG.md` pour ta refonte, et mets à jour `docs/PRODUCT.md` si tu
   changes une convention de présentation (ex. palette, ajout de l'onboarding).
1. **Explore d'abord** le code listé ci-dessous pour comprendre l'existant avant
   de modifier (surtout `+layout.svelte`, `+page.svelte`, `Map.svelte`).
2. Procède **par étapes** : système de design (variables, primitives glass)
   → layout/nav mobile-first → page carte + panneau → onboarding → pages SEO
   (cohérence visuelle) → polish/animations.
3. **Teste le rendu dans le navigateur via un SOUS-AGENT** (lance un agent
   dédié avec les outils MCP Chrome `mcp__claude-in-chrome__*`), à la fois en
   **viewport mobile** (ex. 390×844) et desktop. Capture des screenshots,
   vérifie l'absence d'erreurs console. (C'est une consigne du projet :
   toujours tester Chrome via un sous-agent.)
4. Avant de considérer le travail fini, fais passer **`bun run check`**,
   **`bun run lint`** et **`bun run build`** — tout doit être vert (0 erreur).
   Lance `bun run format` pour le style de code.
5. **Commits** clairs et atomiques sur la branche `feat/ui-liquid-glass`.
   **Ne push pas / ne merge pas sur `main`** sans validation de Julien, et **ne
   déploie pas** (la prod tourne déjà). Termine en proposant un récap des
   changements pour la revue + une éventuelle PR.

### Définition de « terminé »

- UI nettement plus moderne, effet liquid glass cohérent et **performant**
  (attention au coût GPU du `backdrop-filter` sur mobile — reste fluide).
- **Mobile-first réellement** : utilisable au pouce dans un train, carte qui
  respire, panneau ergonomique, cibles tactiles ≥ 44px.
- Onboarding clair qui explique principe + calcul ARCEP + calcul communautaire +
  vie privée + contribution, ré-ouvrable.
- Cohérence visuelle sur **toutes** les pages (carte ET pages SEO).
- `check` + `lint` + `build` verts, testé mobile & desktop via sous-agent Chrome,
  zéro régression fonctionnelle.

Pose des questions à Julien si un choix de direction visuelle est ambigu (ex.
thème sombre vs clair vs auto, ampleur des animations), mais propose un parti
pris fort par défaut — l'objectif est un résultat « waouh » et pro.

---

## Notes pour Julien (hors prompt)

- Quand la branche est prête : revue, puis `git checkout main && git merge
feat/ui-liquid-glass && git push`. Le déploiement se fait ensuite côté serveur :
  `ssh 100.117.235.23` → `cd ~/apps/4g-dans-le-train && git pull && COMPOSE_BAKE=false docker compose build && docker compose up -d --no-build --force-recreate`.
  (Le `COMPOSE_BAKE=false` évite un bug de build qui se bloque sur l'export d'image.)
- Tu peux supprimer ce fichier de handoff une fois la refonte mergée.
