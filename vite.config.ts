import { defineConfig } from 'vitest/config';
import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter(),
			// adapter-node 6 has no runtime ORIGIN variable: the origin is fixed at BUILD time here.
			// Without it, adapter-node assumes https://<host>, and over plain HTTP SvelteKit's CSRF
			// check rejects every form POST (the login) with 403. Build with ORIGIN set to the exact
			// address-bar origin, e.g. ORIGIN=http://103.82.195.48:3000 npm run build.
			paths: { origin: process.env.ORIGIN || undefined }
		})
	],
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}', 'tool/**/*.spec.ts'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
