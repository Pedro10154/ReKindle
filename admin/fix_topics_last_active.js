const admin = require('firebase-admin');
const fs = require('fs');

// --- CONFIGURATION ---
const SERVICE_ACCOUNT_PATH = '../service-account.json';
const SOCIAL_SERVICE_ACCOUNT_PATH = '../service-account-social.json';
const DATABASE_URL = 'https://rekindle-dd1fa-default-rtdb.firebaseio.com/';
const SOCIAL_DATABASE_URL = 'https://rekindle-socials-default-rtdb.firebaseio.com/';

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

function toMillis(val) {
    if (!val) return 0;
    if (typeof val === 'number') return val;
    if (val && typeof val.toMillis === 'function') return val.toMillis();
    return 0;
}

async function main() {
    console.log("Fetching topics...");
    const topicsSnap = await socialDb.collection('topics').get();
    const topicDocs = topicsSnap.docs;
    
    console.log(`Found ${topicDocs.length} topics. Recalculating lastActive and commentCount...`);
    
    let updatedCount = 0;
    
    for (const [index, topicDoc] of topicDocs.entries()) {
        const topic = topicDoc.data();
        
        // Fetch comments for this topic
        const commentsSnap = await topicDoc.ref.collection('comments').get();
        
        // Find newest comment timestamp
        let maxTimestampMs = toMillis(topic.createdAt);
        let commentCount = 0;
        for (const commentDoc of commentsSnap.docs) {
            const comment = commentDoc.data();
            const ts = toMillis(comment.timestamp);
            if (ts > maxTimestampMs) {
                maxTimestampMs = ts;
            }
            commentCount++;
        }
        
        const currentCount = topic.commentCount || 0;
        const currentLastActiveMs = toMillis(topic.lastActive);
        
        const updates = {};
        let needsUpdate = false;
        
        if (maxTimestampMs > 0 && currentLastActiveMs !== maxTimestampMs) {
            process.stdout.write(`\rUpdating [${index + 1}/${topicDocs.length}] (lastActive: ${currentLastActiveMs} -> ${maxTimestampMs})                 `);
            updates.lastActive = admin.firestore.Timestamp.fromMillis(maxTimestampMs);
            needsUpdate = true;
        }
        
        if (currentCount !== commentCount) {
            if (!needsUpdate) {
                process.stdout.write(`\rUpdating [${index + 1}/${topicDocs.length}] (commentCount: ${currentCount} -> ${commentCount})                 `);
            }
            updates.commentCount = commentCount;
            needsUpdate = true;
        }
        
        if (needsUpdate) {
            await topicDoc.ref.update(updates);
            updatedCount++;
        }
    }
    
    console.log(`\n\nFinished! Updated ${updatedCount} topics.`);
    process.exit(0);
}

main().catch(err => {
    console.error("Fatal Error:", err);
    process.exit(1);
});
