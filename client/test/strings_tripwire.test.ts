import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Banned Terms Tripwire', () => {
    const BANNED_TERM = 'accuracy';
    const CLIENT_SRC = path.resolve(__dirname, '../../'); // client/src

    function scanDirectory(dir: string) {
        const files = fs.readdirSync(dir);
        for (const file of files) {
            // Skip node_modules and other irrelevant dirs if they happen to be here
            if (file === 'node_modules' || file === '__snapshots__') continue;

            const fullPath = path.join(dir, file);
            const stat = fs.statSync(fullPath);

            if (stat.isDirectory()) {
                scanDirectory(fullPath);
            } else {
                // Only check source files
                if (!/\.(ts|tsx|js|jsx)$/.test(file)) continue;

                // Create an exception for specific files if absolutely needed (e.g. this test file)
                if (file.includes('strings_tripwire.test.ts')) continue;

                const content = fs.readFileSync(fullPath, 'utf-8');
                const lines = content.split('\n');
                lines.forEach((line, index) => {
                    if (line.toLowerCase().includes(BANNED_TERM.toLowerCase())) {
                        // We use a variable to avoid triggering the check itself on the literal string
                        // But wait, "accuracy" is the term.
                        // I'll use a constructed string to avoid self-match logic issues if I rename.
                    }
                });

                // Simple regex check
                const regex = new RegExp(`\\b${BANNED_TERM}\\b`, 'i');
                if (regex.test(content)) {
                    throw new Error(`Found banned term "${BANNED_TERM}" in ${fullPath}`);
                }
            }
        }
    }

    it(`should not contain the word "${BANNED_TERM}" in client/src`, () => {
        expect(() => scanDirectory(CLIENT_SRC)).not.toThrow();
    });
});
