import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
    test: {
        // `data/` holds gitignored runtime git clones of the repos under review.
        // Those checkouts contain their own *.test/*.spec files (e.g. Playwright
        // suites) that must never be collected by this project's test run.
        exclude: [...configDefaults.exclude, 'data/**'],
    },
});
