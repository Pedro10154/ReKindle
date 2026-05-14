const admin = require('firebase-admin');
const fs = require('fs');

// --- CONFIGURATION ---
const SERVICE_ACCOUNT_PATH = '../service-account.json';
const DATABASE_URL = 'https://rekindle-dd1fa-default-rtdb.firebaseio.com/';

// --- ARGS ---
const args = process.argv.slice(2);
const TARGET_IP = args[0];
const FORMATTED_IP = TARGET_IP ? TARGET_IP.replace(/\./g, '-').replace(/:/g, '_') : null;
const BAN_ACCOUNTS_MODE = args.includes('--ban-accounts');

// --- INIT ---
if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
    console.error(`Error: Service account key not found at ${SERVICE_ACCOUNT_PATH}`);
    process.exit(1);
}

if (!TARGET_IP || TARGET_IP.startsWith('--')) {
    console.error(`Usage: node ban_ip.js <IP_ADDRESS> [--ban-accounts]`);
    console.error(`  --ban-accounts : Optionally disable all users found with this IP address`);
    process.exit(1);
}

const serviceAccount = require(SERVICE_ACCOUNT_PATH);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: DATABASE_URL
});

const rtdb = admin.database();

function safeFirebaseKey(value) {
    return String(value || 'unknown').replace(/[.#$\[\]\/]/g, '_');
}

function userLabel(uid, publicData) {
    if (!publicData) return uid;
    return publicData.displayName || publicData.username || (publicData.email ? publicData.email.split('@')[0] : '') || uid;
}

function buildBannedUserEntry(user, addedBy, addedAt) {
    const entry = {
        uid: user.uid,
        username: user.username || user.uid,
        addedBy
    };
    if (addedAt) {
        entry.addedAt = addedAt;
    } else {
        entry.addedAt = admin.database.ServerValue.TIMESTAMP;
    }
    return entry;
}

async function upsertBannedIp(ip, users, bannedBy) {
    const ref = rtdb.ref(`banned_ips/${FORMATTED_IP}`);
    const snap = await ref.once('value');
    const existing = snap.val() || {};
    const timestamp = admin.database.ServerValue.TIMESTAMP;
    const updates = {
        ip,
        lastUpdatedAt: timestamp,
        lastUpdatedBy: bannedBy
    };

    if (!existing.bannedAt) updates.bannedAt = existing.timestamp || timestamp;
    if (!existing.timestamp) updates.timestamp = existing.bannedAt || timestamp;
    if (!existing.bannedBy) updates.bannedBy = bannedBy;

    const primaryUser = users[0];
    if (primaryUser) {
        if (!existing.bannedUid) updates.bannedUid = primaryUser.uid;
        if (!existing.bannedUsername) updates.bannedUsername = primaryUser.username;
    }

    const existingUsers = existing.bannedUsers || {};
    if (existing.bannedUid && !existingUsers[safeFirebaseKey(existing.bannedUid)]) {
        const existingUser = {
            uid: existing.bannedUid,
            username: existing.bannedUsername || existing.username || existing.bannedUid
        };
        updates[`bannedUsers/${safeFirebaseKey(existing.bannedUid)}`] = buildBannedUserEntry(
            existingUser,
            existing.bannedBy || bannedBy,
            existing.bannedAt || existing.timestamp
        );
    }

    users.forEach(user => {
        updates[`bannedUsers/${safeFirebaseKey(user.uid)}`] = buildBannedUserEntry(user, bannedBy);
    });

    await ref.update(updates);
    return { alreadyBanned: snap.exists() };
}

async function main() {
    console.log(`\n=== ReKindle IP Ban Tool ===`);
    console.log(`Target IP: ${TARGET_IP}`);
    console.log(`Firebase Path: /banned_ips/${FORMATTED_IP}\n`);

    try {
        // 1. Scan and optionally ban existing users
        console.log(`Scanning database for users with this IP...`);
        const [usersPrivateSnap, usersPublicSnap] = await Promise.all([
            rtdb.ref('users_private').once('value'),
            rtdb.ref('users_public').once('value')
        ]);
        const users = usersPrivateSnap.val() || {};
        const publicUsers = usersPublicSnap.val() || {};
        
        let matchingUsers = [];
        for (const uid of Object.keys(users)) {
            if (users[uid].ipAddress === TARGET_IP) {
                matchingUsers.push({
                    uid,
                    username: userLabel(uid, publicUsers[uid])
                });
            }
        }

        // 2. Add IP to banned_ips
        console.log(`\nAdding IP to banned_ips list...`);
        const banResult = await upsertBannedIp(TARGET_IP, matchingUsers, 'admin_script');
        console.log(`[SUCCESS] IP has been banned. New sign-ups and logins from this IP are blocked.`);
        if (banResult.alreadyBanned && matchingUsers.length > 0) {
            console.log(`Existing IP ban updated with matching user(s): ${matchingUsers.map(u => `${u.username} (${u.uid})`).join(', ')}`);
        }

        if (matchingUsers.length === 0) {
            console.log(`No users found tracking to this IP.`);
        } else {
            console.log(`Found ${matchingUsers.length} user(s) matching this IP:`);
            matchingUsers.forEach(u => console.log(` - ${u.username} (UID: ${u.uid})`));

            if (BAN_ACCOUNTS_MODE) {
                console.log(`\nDisabling accounts in Firebase Auth...`);
                let successCount = 0;
                let failCount = 0;
                for (const { uid } of matchingUsers) {
                    try {
                        await admin.auth().updateUser(uid, { disabled: true });
                        console.log(`[OK] Disabled: ${uid}`);
                        successCount++;
                    } catch (e) {
                        console.error(`[FAIL] Error disabling ${uid}: ${e.message}`);
                        failCount++;
                    }
                }
                console.log(`\nAccount Bans Complete. (${successCount} disabled, ${failCount} failed)`);
                console.log(`Note: To clean up these accounts' data, run the wipe_banned_users.js script.`);
            } else {
                console.log(`\nHINT: Their existing accounts remain active. Run again with --ban-accounts to disable them.`);
            }
        }

    } catch (e) {
        console.error("Fatal Error:", e);
    } finally {
        process.exit(0);
    }
}

main();
