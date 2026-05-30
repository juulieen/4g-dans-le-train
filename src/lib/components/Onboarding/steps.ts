/**
 * Contenu du parcours d'onboarding pédagogique (présentation uniquement).
 * Chaque étape explique une facette du projet ; le markup est dans Onboarding.svelte.
 */
export type OnboardingStep = {
	/** Nom d'icône (voir Icon.svelte). */
	icon: string;
	title: string;
	/** Paragraphes de corps (HTML léger autorisé : <strong>, <a>). */
	body: string[];
	/** Type de schéma illustratif optionnel rendu par le composant. */
	visual?: 'legend' | 'route' | 'privacy';
};

export const STEPS: OnboardingStep[] = [
	{
		icon: 'train',
		title: 'Dans le train, anticipez votre réseau',
		body: [
			'Sachez <strong>à l’avance</strong> où vous pourrez regarder une vidéo, faire une recherche… ou rien du tout.',
			'Cette carte montre la couverture mobile (4G/5G) tout au long des lignes de train en France.'
		],
		visual: 'route'
	},
	{
		icon: 'map',
		title: 'Comment lire la carte',
		body: [
			'La <strong>voie est colorée</strong> selon ce que vous pourrez y faire : c’est la couverture <em>théorique</em>.',
			'Les <strong>pastilles cerclées de blanc</strong> sont les mesures <em>réelles</em> des voyageurs. Le vécu prime sur la théorie.'
		],
		visual: 'legend'
	},
	{
		icon: 'signal',
		title: 'D’où viennent les données « théoriques »',
		body: [
			'Ce sont les couvertures <strong>officielles publiées par l’ARCEP</strong> (le régulateur télécom), opérateur par opérateur.',
			'On les projette le long des voies et on les traduit en usages concrets : streaming, web, messages, ou zone blanche.',
			'C’est une <strong>prévision</strong>, pas une garantie — d’où l’intérêt de mesurer pour de vrai.'
		]
	},
	{
		icon: 'lock',
		title: 'Nos mesures, et votre vie privée',
		body: [
			'En « mode mesure », l’app teste votre connexion en continu (un petit <strong>ping</strong> : ça passe / c’est lent / ça coupe) avec votre position.',
			'Votre position est <strong>arrondie à ~150 m</strong> avant tout envoi, <strong>aucune donnée personnelle</strong>, aucune trace ré-identifiable.',
			'Les mesures sont <strong>agrégées par zone et par opérateur</strong>. <a href="/confidentialite">En savoir plus</a>.'
		],
		visual: 'privacy'
	},
	{
		icon: 'sparkle',
		title: 'Enrichissez la carte pour tout le monde',
		body: [
			'Prenez le train, activez le <strong>mode mesure</strong>, et la carte s’améliore pour tous les voyageurs.',
			'Le projet est <strong>open source</strong> et sans publicité. Merci de contribuer&nbsp;!'
		]
	}
];
