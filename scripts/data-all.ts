/**
 * Rafraîchit toutes les données du projet en une seule commande (`bun run data:all`).
 *
 * Enchaîne les imports dans l'ordre de leurs dépendances :
 *   1. SNCF  → static/data/rail-lines.geojson      (prérequis du corridor ARCEP)
 *   2. lignes commerciales → src/lib/geo/commercial-lines.json
 *   3. ARCEP → static/data/arcep-coverage.geojson  (dépend de rail-lines)
 *   4. voies colorées → static/data/arcep-lines.geojson (dépend des deux précédents)
 *
 * S'arrête au premier échec (code de sortie non nul). Le trimestre ARCEP se règle
 * via la variable d'environnement ARCEP_QUARTER (cf. docs/DATA.md).
 */
import { spawn } from 'node:child_process';

const STEPS: { label: string; script: string }[] = [
	{ label: 'Tracés SNCF (rail-lines.geojson)', script: 'scripts/import-sncf-lines.ts' },
	{
		label: 'Lignes commerciales (commercial-lines.json)',
		script: 'scripts/import-commercial-lines.ts'
	},
	{ label: 'Couverture ARCEP (arcep-coverage.geojson)', script: 'scripts/import-arcep.ts' },
	{ label: 'Voies colorées (arcep-lines.geojson)', script: 'scripts/build-arcep-lines.ts' }
];

function run(script: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn('bun', ['run', script], { stdio: 'inherit', env: process.env });
		child.on('error', reject);
		child.on('exit', (code) =>
			code === 0 ? resolve() : reject(new Error(`${script} a quitté avec le code ${code}`))
		);
	});
}

async function main() {
	const total = STEPS.length;
	for (let i = 0; i < total; i++) {
		const { label, script } = STEPS[i];
		console.log(`\n=== [data:all] Étape ${i + 1}/${total} — ${label} ===`);
		await run(script);
	}
	console.log('\n[data:all] Toutes les données ont été régénérées ✅');
}

main().catch((e) => {
	console.error('\n[data:all] échec :', e.message);
	process.exit(1);
});
