#!/usr/bin/env node

/**
 * One-time backfill script for kindlechat/art_index.
 *
 * Scans existing kindlechat/messages and creates lightweight entries in
 * kindlechat/art_index for every pixel art / flipbook post. The gallery can
 * then read only art posts instead of filtering every chat message.
 *
 * Usage:
 *   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/rekindle-socials-service-account.json
 *   node scripts/backfill-art-index.js
 *
 * The script is idempotent: running it again will overwrite the same index
 * entries with the same data.
 */

const admin = require('firebase-admin');

const DATABASE_URL = 'https://rekindle-socials-default-rtdb.firebaseio.com';
const BATCH_SIZE = 100;

admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    databaseURL: DATABASE_URL
});

const db = admin.database();

async function main() {
    console.log('Reading kindlechat/messages...');
    const snapshot = await db.ref('kindlechat/messages').once('value');
    const messages = snapshot.val() || {};
    console.log(`Found ${Object.keys(messages).length} total messages.`);

    const updates = {};
    let artCount = 0;
    let writtenCount = 0;

    for (const msgId in messages) {
        if (!messages.hasOwnProperty(msgId)) continue;
        const msg = messages[msgId];
        if (!msg) continue;

        if (msg.is_pixel_art && msg.pixel_art) {
            updates['kindlechat/art_index/' + msgId] = {
                uid: msg.uid,
                type: 'pixel_art',
                timestamp: msg.timestamp,
                thumbnail: msg.pixel_art,
                text: msg.text || ''
            };
            artCount++;
        } else if (msg.is_flipnote && msg.flipnote_data && msg.flipnote_data.frames && msg.flipnote_data.frames.length > 0) {
            updates['kindlechat/art_index/' + msgId] = {
                uid: msg.uid,
                type: 'flipbook',
                timestamp: msg.timestamp,
                thumbnail: msg.flipnote_data.frames[0],
                text: msg.text || ''
            };
            artCount++;
        }

        if (Object.keys(updates).length >= BATCH_SIZE) {
            await db.ref().update(updates);
            writtenCount += Object.keys(updates).length;
            console.log(`Written ${writtenCount} / ${artCount} art entries so far...`);
            for (const key in updates) delete updates[key];
        }
    }

    if (Object.keys(updates).length > 0) {
        await db.ref().update(updates);
        writtenCount += Object.keys(updates).length;
    }

    console.log(`Done. Found ${artCount} art entries, wrote ${writtenCount}.`);
    process.exit(0);
}

main().catch(function (err) {
    console.error('Backfill failed:', err);
    process.exit(1);
});
