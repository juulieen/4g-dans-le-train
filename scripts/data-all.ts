/**
 * Rafraîchit toutes les données du projet en une seule commande (`bun run data:all`).
 *
 * Enchaîne les imports dans l'ordre de leurs dépendances :
 *   1. SNCF  → static/data/rail-lines.geojson      (prérequis du corridor ARCEP)
 *   2. lignes commerciales → src/lib/geo/commercial-lines.json
 *   3. ARCEP → static/data/arcep-coverage.geojson  (dépend de rail-lines)
 *   4. index ligne + profils de trajet → src/lib/geo/line-index.json
 *      + static/data/route-profiles/*.json (dépend de rail-lines + commercial-lines + ARCEP)
 *   5. voies colorées → static/data/arcep-lines.geojson (dépend des deux précédents)
 *
 * S'arrête au premier échec (code de sortie non nul). Le trimestre ARCEP se règle
 * via la variable d'environnement ARCEP_QUARTER (cf. docs/DATA.md).
 */
import { spawn } from 'node:child_process';

// On délègue aux scripts npm (`bun run data:*`) plutôt qu'aux chemins de fichiers
// pour garder package.json comme unique source de vérité : si un script est
// renommé/déplacé, `data:all` reste cohérent.
const STEPS: { label: string; task: string }[] = [
	{ label: 'Tracés SNCF (rail-lines.geojson)', task: 'data:sncf' },
	{ label: 'Lignes commerciales (commercial-lines.json)', task: 'data:lines' },
	{ label: 'Couverture ARCEP (arcep-coverage.geojson)', task: 'data:arcep' },
	{
		label: 'Index ligne + profils de trajet (line-index.json + route-profiles/)',
		task: 'data:line-index'
	},
	{ label: 'Voies colorées (arcep-lines.geojson)', task: 'data:arcep-lines' }
];

function run(task: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn('bun', ['run', task], { stdio: 'inherit', env: process.env });
		child.on('error', reject);
		child.on('exit', (code) =>
			code === 0 ? resolve() : reject(new Error(`${task} a quitté avec le code ${code}`))
		);
	});
}

async function main() {
	const total = STEPS.length;
	for (let i = 0; i < total; i++) {
		const { label, task } = STEPS[i];
		console.log(`\n=== [data:all] Étape ${i + 1}/${total} — ${label} ===`);
		await run(task);
	}
	console.log('\n[data:all] Toutes les données ont été régénérées ✅');
}

main().catch((e) => {
	console.error('\n[data:all] échec :', e.message);
	process.exit(1);
});
