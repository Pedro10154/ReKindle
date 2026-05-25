const admin = require('firebase-admin');
const fs = require('fs');

// --- CONFIGURATION ---
const SERVICE_ACCOUNT_PATH = '../service-account.json';
const SOCIAL_SERVICE_ACCOUNT_PATH = '../service-account-social.json';
const DATABASE_URL = 'https://rekindle-dd1fa-default-rtdb.firebaseio.com/';
const SOCIAL_DATABASE_URL = 'https://rekindle-socials-default-rtdb.firebaseio.com/';

// --- ARGS ---
const args = process.argv.slice(2);
const FORCE_MODE = args.includes('--force');

// --- INIT ---
if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
    console.error(`Error: Service account key not found at ${SERVICE_ACCOUNT_PATH}`);
    process.exit(1);
}

const serviceAccount = require(SERVICE_ACCOUNT_PATH);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: DATABASE_URL
});

// Initialize secondary app for social project (optional — falls back to main if key missing)
let socialRtdb = admin.database();
let socialDb = null;
try {
    if (fs.existsSync(SOCIAL_SERVICE_ACCOUNT_PATH)) {
        const socialServiceAccount = require(SOCIAL_SERVICE_ACCOUNT_PATH);
        const socialApp = admin.initializeApp({
            credential: admin.credential.cert(socialServiceAccount),
            databaseURL: SOCIAL_DATABASE_URL
        }, 'social-admin');
        socialRtdb = socialApp.database();
        socialDb = socialApp.firestore();
        console.log('Social admin app initialized.');
    } else {
        console.warn('Social service account not found at ' + SOCIAL_SERVICE_ACCOUNT_PATH + ' — using main project for social data.');
    }
} catch (e) {
    console.warn('Failed to initialize social admin app:', e.message);
}

const rtdb = admin.database();

let deletionTasks = [];

async function main() {
    console.log(`\n=== ReKindle Banned Users Cleanup Tool ===`);
    console.log(`Mode: ${FORCE_MODE ? 'WET RUN (DELETING)' : 'DRY RUN (READ ONLY)'}\n`);

    try {
        const bannedUids = await getBannedUsers();
        if (bannedUids.size === 0) {
            console.log("No banned users found.");
            process.exit(0);
        }

        console.log(`Found ${bannedUids.size} disabled (banned) users.`);

        // Scan users_public
        await scanUsersPublic(bannedUids);

        // Scan Neighbourhood
        await scanNeighbourhood(bannedUids);

        console.log(`\n=== Summary ===`);
        console.log(`Total items found for deletion: ${deletionTasks.length}`);

        if (deletionTasks.length > 0) {
            if (FORCE_MODE) {
                await executeDeletions();
            } else {
                console.log(`\n[DRY RUN] No changes made. Run with --force to execute.`);
            }
        }

    } catch (e) {
        console.error("Fatal Error:", e);
    } finally {
        process.exit(0);
    }
}

async function getBannedUsers() {
    console.log("Fetching users from Firebase Auth...");
    const disabledUids = new Set();
    let nextPageToken;

    do {
        const listUsersResult = await admin.auth().listUsers(1000, nextPageToken);
        listUsersResult.users.forEach((userRecord) => {
            if (userRecord.disabled) {
                disabledUids.add(userRecord.uid);
            }
        });
        nextPageToken = listUsersResult.pageToken;
    } while (nextPageToken);

    return disabledUids;
}

async function scanUsersPublic(bannedUids) {
    console.log("Scanning users_public for profiles...");
    const profilesSnap = await rtdb.ref('users_public').once('value');
    const profiles = profilesSnap.val() || {};

    for (const uid of Object.keys(profiles)) {
        if (bannedUids.has(uid)) {
            deletionTasks.push({
                type: 'Public Profile',
                id: uid,
                summary: profiles[uid].displayName || 'Unknown user',
                action: () => rtdb.ref(`users_public/${uid}`).remove()
            });
        }
    }
}

async function scanNeighbourhood(bannedUids) {
    console.log("Scanning Neighbourhood posts and comments...");
    
    const allPostsSnap = await socialDb.collection('neighbourhood_posts').get();
    
    for (const postDoc of allPostsSnap.docs) {
        const postId = postDoc.id;
        const post = postDoc.data();

        if (bannedUids.has(post.uid)) {
            deletionTasks.push({
                type: 'Neighbourhood Post',
                id: postId,
                summary: (post.text || '').substring(0, 50),
                action: async () => {
                    const commentsSnap = await socialDb.collection('neighbourhood_posts').doc(postId).collection('comments').get();
                    const batch = socialDb.batch();
                    commentsSnap.docs.forEach(c => batch.delete(c.ref));
                    if (commentsSnap.docs.length > 0) await batch.commit();
                    await socialDb.collection('neighbourhood_posts').doc(postId).delete();
                }
            });
            // If the whole post is removed, we don't need to process its comments separately.
            continue;
        }

        // Process comments on non-banned users' posts
        const commentsSnap = await postDoc.ref.collection('comments').get();
        for (const commentDoc of commentsSnap.docs) {
            const commentData = commentDoc.data();
            if (bannedUids.has(commentData.uid)) {
                deletionTasks.push({
                    type: 'Neighbourhood Comment',
                    id: commentDoc.id,
                    summary: (commentData.text || '').substring(0, 50),
                    action: () => commentDoc.ref.delete()
                });
            }
        }
    }
}

async function executeDeletions() {
    console.log(`\nExecuting ${deletionTasks.length} deletions...`);

    let deletedCount = 0;
    let errors = 0;

    for (const task of deletionTasks) {
        try {
            process.stdout.write(`Deleting ${task.type} (${task.id})... `);
            await task.action();
            process.stdout.write("DONE\n");
            deletedCount++;
        } catch (e) {
            process.stdout.write("FAILED\n");
            console.error(e.message);
            errors++;
        }
    }

    console.log(`\nOperation Complete.`);
    console.log(`Deleted: ${deletedCount}`);
    console.log(`Errors: ${errors}`);
}

main();
