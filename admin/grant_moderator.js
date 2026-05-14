const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// --- CONFIGURATION ---
const SERVICE_ACCOUNT_PATH = path.resolve(__dirname, '..', 'service-account.json');
const DATABASE_URL = 'https://rekindle-dd1fa-default-rtdb.firebaseio.com/';
const SCRIPT_PATH = path.relative(process.cwd(), __filename) || path.basename(__filename);

// --- ARGS ---
const args = process.argv.slice(2);

function printUsage() {
    console.log('Usage:');
    console.log(`  node ${SCRIPT_PATH} <email_or_username_or_uid>`);
    console.log(`  node ${SCRIPT_PATH} <email_or_username_or_uid> --revoke`);
    console.log('');
    console.log('Examples:');
    console.log(`  node ${SCRIPT_PATH} moderator@rekindle.ink`);
    console.log(`  node ${SCRIPT_PATH} john --revoke`);
    process.exit(1);
}

if (args.length < 1) printUsage();

const TARGET = args[0];
const IS_REVOKE = args.includes('--revoke');

// --- INIT ---
if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
    console.error(`Error: Service account key not found at ${SERVICE_ACCOUNT_PATH}`);
    console.error('Please download it from Firebase Console -> Project Settings -> Service Accounts');
    process.exit(1);
}

const serviceAccount = require(SERVICE_ACCOUNT_PATH);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: DATABASE_URL
});

const rtdb = admin.database();
const firestore = admin.firestore();

// --- RESOLVE USER ---
async function resolveUser(target) {
    // Try as email via Firebase Auth
    if (target.includes('@')) {
        try {
            const userRecord = await admin.auth().getUserByEmail(target);
            return {
                uid: userRecord.uid,
                name: userRecord.displayName || target.split('@')[0],
                email: userRecord.email
            };
        } catch (e) {
            // not found in Auth by email, fall through
        }
    }

    // Try as UID
    if (target.length > 20 && !target.includes(' ')) {
        try {
            const userRecord = await admin.auth().getUser(target);
            return {
                uid: userRecord.uid,
                name: userRecord.displayName || target,
                email: userRecord.email || ''
            };
        } catch (e) {
            // not a valid UID, fall through
        }
    }

    // Look up in users_public by displayName, username, or email
    const snap = await rtdb.ref('users_public').once('value');
    const users = snap.val() || {};
    for (const [uid, data] of Object.entries(users)) {
        const displayName = (data.displayName || '').toLowerCase();
        const username = (data.username || '').toLowerCase();
        const email = (data.email || '').toLowerCase();
        const t = target.toLowerCase();
        if (displayName === t || username === t || email === t || email.startsWith(t + '@') || uid === target) {
            return { uid, name: data.displayName || data.username || t, email: data.email || '' };
        }
    }

    return null;
}

// --- MAIN ---
async function main() {
    console.log('\n=== ReKindle Moderator Management ===');
    console.log(`Target:  ${TARGET}`);
    console.log(`Action:  ${IS_REVOKE ? 'REVOKE moderator status' : 'GRANT moderator status'}`);
    console.log('');

    try {
        const user = await resolveUser(TARGET);

        if (!user) {
            console.error(`Error: Could not resolve user "${TARGET}". Check the email, username, or UID and try again.`);
            process.exit(1);
        }

        console.log(`Resolved: ${user.name} (UID: ${user.uid}${user.email ? ', Email: ' + user.email : ''})`);
        console.log('');

        // Update RTDB moderators node
        if (IS_REVOKE) {
            await rtdb.ref('moderators/' + user.uid).remove();
            console.log('✓ Removed from RTDB moderators node');
        } else {
            await rtdb.ref('moderators/' + user.uid).set(true);
            console.log('✓ Added to RTDB moderators node');
        }

        // Update Firestore config/moderators document
        const modRef = firestore.collection('config').doc('moderators');
        if (IS_REVOKE) {
            await modRef.set({ [user.uid]: admin.firestore.FieldValue.delete() }, { merge: true });
            console.log('✓ Removed from Firestore config/moderators');
        } else {
            await modRef.set({ [user.uid]: true }, { merge: true });
            console.log('✓ Added to Firestore config/moderators');
        }

        console.log('');
        if (IS_REVOKE) {
            console.log(`Done. ${user.name} is no longer a moderator.`);
        } else {
            console.log(`Done. ${user.name} is now a moderator.`);
            console.log('');
            console.log('Moderator permissions:');
            console.log('  - Delete messages in KindleChat general chat');
            console.log('  - Delete comments in Topics');
            console.log('  - Delete posts and comments in Neighbourhood');
            console.log('  - Apply social timeouts (up to 24 hours, on non-moderators)');
            console.log('  - Read automod log and automod strikes');
            console.log('  - Log mod actions');
        }
        console.log('');
        console.log('Remember to deploy updated Firebase rules if you have not already:');
        console.log('  firebase deploy --only database,firestore:rules');

    } catch (err) {
        console.error('Error:', err.message || err);
        process.exit(1);
    }

    process.exit(0);
}

main();
