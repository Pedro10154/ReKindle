/**
 * Age Verification integration for ReKindle social apps (OAuth2 + QR Code flow).
 * Optimized for Kindle devices: users scan a QR code with their phone to verify.
 *
 * Usage:
 *   ensureAgeVerified(authInstance).then(() => { // proceed with app })
 *   .catch((err) => { // block access });
 */

(function (window) {
    'use strict';

    var POLL_INTERVAL = 3000;   // Check RTDB every 3 seconds
    var POLL_TIMEOUT = 10 * 60 * 1000; // 10 minute timeout

    /**
     * Ensure the current Firebase Auth user has the ageVerified custom claim.
     * If not, show a QR-code modal for cross-device verification.
     *
     * @param {firebase.auth.Auth} auth - Firebase Auth instance
     * @param {object} options
     * @param {boolean} options.closable - Whether the modal can be closed without verifying
     * @returns {Promise<void>}
     */
    function ensureAgeVerified(auth, options) {
        options = options || {};

        if (!auth || !auth.currentUser) {
            return Promise.reject(new Error('User must be signed in to verify age.'));
        }

        // Check current token claims first
        return auth.currentUser.getIdTokenResult(true).then(function(idTokenResult) {
            if (idTokenResult.claims.ageVerified === true) {
                return; // Already verified
            }

            // Need to start OAuth2 flow
            return startOAuth2Flow(auth, options);
        });
    }

    /**
     * Start the OAuth2 verification flow: call backend, show modal, poll RTDB.
     */
    function startOAuth2Flow(auth, options) {
        return new Promise(function(resolve, reject) {
            var functions = firebase.functions();
            var startFn = functions.httpsCallable('startAgeVerification');

            startFn({ redirectApp: window.location.href })
                .then(function(result) {
                    var data = result.data;
                    if (!data || !data.sessionId || !data.authUrl) {
                        throw new Error('Invalid response from server.');
                    }
                    showVerificationModal(data.authUrl, data.sessionId, options.closable, reject);
                    beginPolling(auth, data.sessionId, resolve, reject);
                })
                .catch(function(err) {
                    reject(new Error(err.message || 'Failed to start age verification.'));
                });
        });
    }

    /**
     * Show the verification modal with QR code and same-device link.
     */
    function showVerificationModal(authUrl, sessionId, closable, onCancel) {
        // Remove existing modal if present
        var existing = document.getElementById('rekindle-ageverif-modal');
        if (existing) existing.remove();

        var modal = document.createElement('div');
        modal.id = 'rekindle-ageverif-modal';
        modal.style.cssText =
            'position:fixed;top:0;left:0;width:100%;height:100%;' +
            'background:rgba(0,0,0,0.85);z-index:99999;' +
            'display:flex;align-items:center;justify-content:center;' +
            'font-family:"Courier New",Courier,monospace;';

        var qrSrc = 'https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=' + encodeURIComponent(authUrl);

        var closeBtn = closable
            ? '<button id="ageverif-close" style="margin-top:15px;padding:8px 16px;border:2px solid #fff;background:transparent;color:#fff;font-family:inherit;font-size:13px;cursor:pointer;">Close</button>'
            : '';

        modal.innerHTML =
            '<div style="background:#fff;border:2px solid #000;box-shadow:4px 4px 0 #000;padding:25px;max-width:360px;width:90%;text-align:center;">' +
            '<div style="font-size:16px;font-weight:bold;margin-bottom:15px;border-bottom:2px solid #000;padding-bottom:10px;">Age Verification Required</div>' +
            '<div style="font-size:13px;margin-bottom:15px;line-height:1.5;">' +
            'To access social features, please verify your age.' +
            '</div>' +
            '<div style="margin-bottom:15px;">' +
            '<img src="' + qrSrc + '" alt="Scan QR code" style="border:2px solid #000;display:block;margin:0 auto;max-width:250px;width:100%;" onerror="this.style.display=\'none\';document.getElementById(\'ageverif-qr-fallback\').style.display=\'block\';">' +
            '<div id="ageverif-qr-fallback" style="display:none;font-size:12px;word-break:break-all;padding:10px;border:2px dashed #000;background:#f5f5f5;">' + escapeHtml(authUrl) + '</div>' +
            '</div>' +
            '<div style="font-size:12px;color:#555;margin-bottom:15px;">' +
            '<strong>On a Kindle?</strong> Scan this QR code with your phone to verify.' +
            '</div>' +
            '<a href="' + escapeHtml(authUrl) + '" target="_blank" rel="noopener" style="display:inline-block;padding:10px 20px;border:2px solid #000;background:#ddd;color:#000;text-decoration:none;font-size:13px;font-weight:bold;">' +
            'Verify on this device' +
            '</a>' +
            closeBtn +
            '</div>';

        document.body.appendChild(modal);

        if (closable) {
            document.getElementById('ageverif-close').addEventListener('click', function() {
                modal.remove();
                onCancel(new Error('Age verification was cancelled.'));
            });
        }
    }

    /**
     * Poll RTDB for session status changes.
     */
    function beginPolling(auth, sessionId, resolve, reject) {
        var db = firebase.database();
        var sessionRef = db.ref('age_verification_sessions/' + sessionId);
        var startTime = Date.now();
        var intervalId = null;
        var resolved = false;

        function cleanup() {
            if (intervalId) clearInterval(intervalId);
            var modal = document.getElementById('rekindle-ageverif-modal');
            if (modal) modal.remove();
        }

        function onSuccess() {
            if (resolved) return;
            resolved = true;
            cleanup();
            // Force token refresh to pick up the new custom claim
            auth.currentUser.getIdToken(true).then(function() {
                resolve();
            }).catch(function() {
                resolve(); // Token refresh failure is non-fatal
            });
        }

        function onError(msg) {
            if (resolved) return;
            resolved = true;
            cleanup();
            reject(new Error(msg || 'Age verification failed.'));
        }

        // Use on('value') for real-time updates (more efficient than polling)
        var listener = sessionRef.on('value', function(snap) {
            var data = snap.val();
            if (!data) return;

            if (data.status === 'verified') {
                sessionRef.off('value', listener);
                onSuccess();
            } else if (data.status === 'failed') {
                sessionRef.off('value', listener);
                onError(data.reason || 'Age verification was not completed successfully.');
            }
        }, function(err) {
            // RTDB read error — fall back to interval polling
            sessionRef.off('value', listener);
            startIntervalPolling();
        });

        // Fallback interval polling in case on('value') fails
        function startIntervalPolling() {
            intervalId = setInterval(function() {
                if (Date.now() - startTime > POLL_TIMEOUT) {
                    clearInterval(intervalId);
                    cleanup();
                    reject(new Error('Age verification timed out. Please try again.'));
                    return;
                }

                sessionRef.once('value').then(function(snap) {
                    var data = snap.val();
                    if (!data) return;

                    if (data.status === 'verified') {
                        clearInterval(intervalId);
                        onSuccess();
                    } else if (data.status === 'failed') {
                        clearInterval(intervalId);
                        onError(data.reason || 'Age verification was not completed successfully.');
                    }
                }).catch(function() {
                    // Ignore polling errors
                });
            }, POLL_INTERVAL);
        }
    }

    function escapeHtml(text) {
        var div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Expose globally
    window.ensureAgeVerified = ensureAgeVerified;
})(window);
