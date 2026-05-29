# Contribuer à « 4G dans le train »

Merci de votre intérêt ! Deux façons de contribuer.

## 1. Contribuer des données (sans coder) 🚆

La façon la plus utile : **prenez le train, ouvrez le site, activez le mode mesure.**
Vos mesures (anonymes) enrichissent la carte pour tout le monde.

## 2. Contribuer du code 💻

### Prérequis

- [Bun](https://bun.sh) ≥ 1.1
- Git

### Mise en route

```bash
git clone https://github.com/<vous>/4g-dans-le-train.git
cd 4g-dans-le-train
bun install
cp .env.example .env
bun run dev
```

### Avant d'ouvrir une PR

```bash
bun run check    # types
bun run lint     # format + lint
bun run test     # tests unitaires
```

### Conventions

- Commits en français ou anglais, format court et descriptif.
- Une PR = une intention claire. Décrivez le _pourquoi_, pas seulement le _quoi_.
- Respectez la vie privée : aucune donnée ne doit permettre de ré-identifier un
  utilisateur ou de reconstituer un trajet individuel. Le binning H3 et
  l'anonymisation des sessions ne sont pas négociables.

### Pistes (issues « good first issue »)

- Améliorer l'import/simplification des tracés SNCF.
- Ajouter des opérateurs / pays.
- Pages SEO par ligne (`/ligne/[slug]`).
- Accessibilité de la carte.
