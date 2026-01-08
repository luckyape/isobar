import { describe, it, expect } from 'vitest';
import { packageManifest, unpackageManifest, createManifest } from '../manifest';
import { canonicalMsgPack } from '../canonical';
import { DailyManifest } from '../types';
import { ed25519 } from '@noble/curves/ed25519.js';
import { toHex } from '../hash';

describe('Manifest Authenticity', () => {
    // Generate valid keys
    const privKey = ed25519.utils.randomSecretKey();
    const pubKey = ed25519.getPublicKey(privKey);
    const privKeyHex = toHex(privKey);
    const pubKeyHex = toHex(pubKey);

    const manifestContent = createManifest({
        date: '2026-01-01',
        artifacts: []
    });

    it('signs manifest correctly', async () => {
        const { blob, hash } = await packageManifest({ ...manifestContent }, privKeyHex);

        // Verify we can read it back with the public key
        const restored = await unpackageManifest(blob, pubKeyHex);
        expect(restored.date).toBe('2026-01-01');
        expect(restored.signature).toBeDefined();
    });

    it('rejects manifest if signature missing when key provided', async () => {
        // Sign it...
        const { blob } = await packageManifest({ ...manifestContent }, privKeyHex);

        // ...but tamper to remove signature (harder with opaque blob, so we package without key)
        const { blob: unsignedBlob } = await packageManifest({ ...manifestContent }); // No key = no sign

        await expect(unpackageManifest(unsignedBlob, pubKeyHex))
            .rejects.toThrow(/manifest is not signed/);
    });

    it('rejects manifest if signature invalid', async () => {
        const { blob } = await packageManifest({ ...manifestContent }, privKeyHex);

        // Tamper with the blob? Or use wrong key?
        const wrongKey = ed25519.utils.randomSecretKey();
        const wrongPubKey = toHex(ed25519.getPublicKey(wrongKey));

        await expect(unpackageManifest(blob, wrongPubKey))
            .rejects.toThrow(/signed by unexpected key/);
    });

    it('allows unsigned checks if no key expected', async () => {
        const { blob } = await packageManifest({ ...manifestContent }, privKeyHex);

        // Don't pass expected key -> verifies integrity (hash) but ignores signature
        const result = await unpackageManifest(blob);
        expect(result.date).toBe('2026-01-01');
    });

    it('fails if signed content differs from canonical content (canary for signing scope)', async () => {
        // 1. Create content (valid object structure)
        const manifest = createManifest({ date: '2024-01-01', artifacts: [] });

        // 2. Sign "Wrong" content (e.g. simulating a bug where we sign with an extra field)
        const privKey = ed25519.utils.randomSecretKey();
        const pubKey = ed25519.getPublicKey(privKey);

        const driftedManifest = { ...manifest, _hiddenDrift: true };
        const driftedBytes = canonicalMsgPack(driftedManifest);
        const signature = ed25519.sign(driftedBytes, privKey);

        const signedManifest: DailyManifest = {
            ...manifest,
            signature: {
                signature: toHex(signature),
                publicKey: toHex(pubKey),
                signedAt: new Date().toISOString()
            }
        };

        // Package it (without signing again, just packing)
        const { blob: packaged } = await packageManifest(signedManifest);

        // Expect failure because verifying 'packaged' will derive canonical(manifest) 
        // which matches 'manifest' NOT 'driftedManifest'.
        // So Verify(key, canonical(manifest), sig) will FAIL.
        await expect(unpackageManifest(packaged, toHex(pubKey)))
            .rejects.toThrow(/invalid signature/);
    });
});
