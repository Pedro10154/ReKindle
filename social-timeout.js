/**
 * social-timeout.js
 * Shared module for checking social feature timeouts.
 * Include this script in any social app (KindleChat, Topics, Neighbourhood, Suggestions).
 *
 * Usage: checkSocialTimeout(rtdbInstance, userId, onClearCallback)
 *  - If no timeout exists or it has expired, calls onClearCallback() immediately.
 *  - If timed out, shows a blocking modal with reason + countdown and never calls onClearCallback()
 *    until the countdown expires.
 */

// eslint-disable-next-line no-unused-vars
function checkSocialTimeout(rtdb, uid, onClear) {
    var CACHE_KEY = 'sto_clear';      // "no timeout" cache
    var OFFSET_KEY = 'sto_offset';    // server time offset cache
    var CACHE_TTL = 5 * 60 * 1000;   // 5 minutes — bans propagate within this window
    var OFFSET_TTL = 60 * 60 * 1000; // 1 hour — server offset is stable

    // Fast path: cached "no timeout" result for this user
    try {
        var cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
        if (cached && cached.uid === uid && (Date.now() - cached.t < CACHE_TTL)) {
            onClear();
            return;
        }
    } catch (e) {}

    // Try cached server time offset to avoid that RTDB read
    var cachedOffset = null;
    try {
        var offsetData = JSON.parse(localStorage.getItem(OFFSET_KEY) || 'null');
        if (offsetData && (Date.now() - offsetData.t < OFFSET_TTL)) {
            cachedOffset = offsetData.v;
        }
    } catch (e) {}

    var getOffset = (cachedOffset !== null)
        ? Promise.resolve(cachedOffset)
        : rtdb.ref('.info/serverTimeOffset').once('value').then(function (snap) {
            var offset = snap.val() || 0;
            try { localStorage.setItem(OFFSET_KEY, JSON.stringify({ v: offset, t: Date.now() })); } catch (e) {}
            return offset;
        });

    getOffset.then(function (serverOffset) {
        rtdb.ref('social_timeouts/' + uid).once('value').then(function (snap) {
            var data = snap.val();

            // No timeout set for this user — cache and proceed
            if (!data || !data.reason || !data.durationHours) {
                try { localStorage.setItem(CACHE_KEY, JSON.stringify({ uid: uid, t: Date.now() })); } catch (e) {}
                onClear();
                return;
            }

            var reason = data.reason;
            var durationMs = data.durationHours * 60 * 60 * 1000;
            var seenRef = rtdb.ref('users_private/' + uid + '/timeout_seen');

            seenRef.once('value').then(function (seenSnap) {
                var seenAt = seenSnap.val();

                if (!seenAt) {
                    // First time seeing — write server timestamp, then re-read it
                    seenRef.set(firebase.database.ServerValue.TIMESTAMP).then(function () {
                        seenRef.once('value').then(function (freshSnap) {
                            seenAt = freshSnap.val();
                            _evaluateTimeout(reason, durationMs, seenAt, serverOffset, onClear);
                        });
                    });
                } else {
                    _evaluateTimeout(reason, durationMs, seenAt, serverOffset, onClear);
                }
            });
        });
    })['catch'](function (err) {
        console.error('social-timeout: Error checking timeout', err);
        // On error, let the user through rather than blocking them permanently
        onClear();
    });
}

function _getServerNow(offset) {
    return Date.now() + offset;
}

function _evaluateTimeout(reason, durationMs, seenAt, serverOffset, onClear) {
    var expiresAt = seenAt + durationMs;
    var serverNow = _getServerNow(serverOffset);
    var remaining = expiresAt - serverNow;

    if (remaining <= 0) {
        onClear();
        return;
    }

    _showTimeoutModal(reason, expiresAt, serverOffset, onClear);
}

function _showTimeoutModal(reason, expiresAt, serverOffset, onClear) {
    // Create overlay
    var overlay = document.createElement('div');
    overlay.id = 'social-timeout-overlay';
    overlay.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; ' +
        'background:rgba(255,255,255,0.97); z-index:10000; display:flex; ' +
        'align-items:center; justify-content:center; font-family:"Geneva","Verdana",sans-serif;';

    // Create modal window
    var box = document.createElement('div');
    box.style.cssText = 'background:white; border:2px solid black; box-shadow:4px 4px 0 black; ' +
        'width:85%; max-width:350px; text-align:center;';

    // Title bar
    var titleBar = document.createElement('div');
    titleBar.style.cssText = 'position:relative; height:35px; border-bottom:2px solid black; display:flex; align-items:center; justify-content:center; overflow:hidden;';

    // Stripes background
    var stripes = document.createElement('div');
    stripes.style.cssText = 'position:absolute; top:0; left:0; right:0; bottom:0; z-index:0; ' +
        'background:repeating-linear-gradient(transparent, transparent 2px, black 2px, black 3px);';
    titleBar.appendChild(stripes);

    // Close button
    var closeBtn = document.createElement('div');
    closeBtn.style.cssText = 'position:absolute; left:8px; top:50%; transform:translateY(-50%); z-index:2; ' +
        'width:22px; height:22px; border:2px solid black; background:white; display:flex; ' +
        'align-items:center; justify-content:center; font-weight:bold; font-size:12px; cursor:pointer; box-shadow:1px 1px 0 black;';
    closeBtn.textContent = 'X';
    closeBtn.onclick = function () { window.location.href = 'index'; };
    titleBar.appendChild(closeBtn);

    box.appendChild(titleBar);

    // Content area
    var content = document.createElement('div');
    content.style.cssText = 'padding:20px;';

    // Title heading
    var heading = document.createElement('h2');
    heading.style.cssText = 'margin:0 0 15px 0; padding-bottom:10px; border-bottom:2px solid black; font-size:1.2rem;';
    heading.textContent = 'Social Features Unavailable';
    content.appendChild(heading);

    // Reason
    var reasonLabel = document.createElement('div');
    reasonLabel.style.cssText = 'font-weight:bold; font-size:0.85rem; margin-bottom:5px; text-transform:uppercase; color:#666;';
    reasonLabel.textContent = 'Reason';
    content.appendChild(reasonLabel);

    var reasonText = document.createElement('p');
    reasonText.style.cssText = 'margin:0 0 20px 0; font-size:1rem; line-height:1.4; padding:10px; border:1px solid #ccc; background:#f9f9f9;';
    reasonText.textContent = reason;
    content.appendChild(reasonText);

    // Countdown label
    var countdownLabel = document.createElement('div');
    countdownLabel.style.cssText = 'font-weight:bold; font-size:0.85rem; margin-bottom:5px; text-transform:uppercase; color:#666;';
    countdownLabel.textContent = 'Time Remaining';
    content.appendChild(countdownLabel);

    // Countdown display
    var countdownEl = document.createElement('div');
    countdownEl.style.cssText = 'font-size:1.8rem; font-weight:bold; padding:10px; border:2px solid black; background:#fafafa; margin-bottom:15px; font-family:monospace;';
    countdownEl.textContent = '--:--:--';
    content.appendChild(countdownEl);

    // Info text
    var info = document.createElement('p');
    info.style.cssText = 'font-size:0.8rem; color:#666; margin:0;';
    info.textContent = 'This app will become available when the countdown reaches zero.';
    content.appendChild(info);

    box.appendChild(content);

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    // Update countdown every second (using server-corrected time)
    function updateCountdown() {
        var serverNow = _getServerNow(serverOffset);
        var remaining = expiresAt - serverNow;

        if (remaining <= 0) {
            // Timeout expired — remove modal and let the user through
            if (overlay.parentNode) {
                overlay.parentNode.removeChild(overlay);
            }
            onClear();
            return;
        }

        var totalSeconds = Math.ceil(remaining / 1000);
        var hours = Math.floor(totalSeconds / 3600);
        var minutes = Math.floor((totalSeconds % 3600) / 60);
        var seconds = totalSeconds % 60;

        // Pad with leading zeros
        var hStr = hours < 10 ? '0' + hours : '' + hours;
        var mStr = minutes < 10 ? '0' + minutes : '' + minutes;
        var sStr = seconds < 10 ? '0' + seconds : '' + seconds;

        countdownEl.textContent = hStr + ':' + mStr + ':' + sStr;

        setTimeout(updateCountdown, 1000);
    }

    updateCountdown();
}
