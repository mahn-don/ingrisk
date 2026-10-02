// Heuristic guard: fail if any .svelte file under src/ contains Vietnamese-specific
// characters. User-facing strings belong in src/lib/messages/vi.ts.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// After NFD normalization: grave, acute, circumflex, tilde, breve, hook above,
// horn, dot below (covers tone marks and a/e/o/u variants), plus d-with-stroke.
const VIETNAMESE = /[̛̣̀́̂̃̆̉Đđ]/;

function* svelteFiles(dir) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) yield* svelteFiles(path);
		else if (entry.name.endsWith('.svelte')) yield path;
	}
}

let hits = 0;
for (const file of svelteFiles('src')) {
	readFileSync(file, 'utf8')
		.split('\n')
		.forEach((line, i) => {
			if (VIETNAMESE.test(line.normalize('NFD'))) {
				hits++;
				console.error(`${file}:${i + 1}: ${line.trim()}`);
			}
		});
}

if (hits > 0) {
	console.error(`\n${hits} line(s) with Vietnamese text in .svelte files. Move them to src/lib/messages/vi.ts.`);
	process.exit(1);
}
console.log('lint:strings: no Vietnamese literals in .svelte files.');
