/**
 * Age Verification for ReKindle social apps — Self-Declaration flow.
 * Users enter their date of birth and country; the backend calculates age
 * and enforces country-specific minimum social-media age requirements.
 *
 * Usage:
 *   ensureAgeVerified(authInstance).then(() => { // proceed with app })
 *   .catch((err) => { // block access });
 */

(function (window) {
    'use strict';

    var COUNTRIES = [
        { code: 'AR', name: 'Argentina' },
        { code: 'AT', name: 'Austria' },
        { code: 'AU', name: 'Australia' },
        { code: 'BD', name: 'Bangladesh' },
        { code: 'BE', name: 'Belgium' },
        { code: 'BH', name: 'Bahrain' },
        { code: 'BO', name: 'Bolivia' },
        { code: 'BR', name: 'Brazil' },
        { code: 'BG', name: 'Bulgaria' },
        { code: 'CA', name: 'Canada' },
        { code: 'CL', name: 'Chile' },
        { code: 'CN', name: 'China' },
        { code: 'CO', name: 'Colombia' },
        { code: 'CR', name: 'Costa Rica' },
        { code: 'HR', name: 'Croatia' },
        { code: 'CU', name: 'Cuba' },
        { code: 'CY', name: 'Cyprus' },
        { code: 'CZ', name: 'Czech Republic' },
        { code: 'DK', name: 'Denmark' },
        { code: 'DO', name: 'Dominican Republic' },
        { code: 'EC', name: 'Ecuador' },
        { code: 'EG', name: 'Egypt' },
        { code: 'EE', name: 'Estonia' },
        { code: 'FJ', name: 'Fiji' },
        { code: 'FI', name: 'Finland' },
        { code: 'FR', name: 'France' },
        { code: 'DE', name: 'Germany' },
        { code: 'GH', name: 'Ghana' },
        { code: 'GR', name: 'Greece' },
        { code: 'GT', name: 'Guatemala' },
        { code: 'HN', name: 'Honduras' },
        { code: 'HK', name: 'Hong Kong' },
        { code: 'HU', name: 'Hungary' },
        { code: 'IS', name: 'Iceland' },
        { code: 'IN', name: 'India' },
        { code: 'ID', name: 'Indonesia' },
        { code: 'IE', name: 'Ireland' },
        { code: 'IL', name: 'Israel' },
        { code: 'IT', name: 'Italy' },
        { code: 'JM', name: 'Jamaica' },
        { code: 'JP', name: 'Japan' },
        { code: 'KE', name: 'Kenya' },
        { code: 'KW', name: 'Kuwait' },
        { code: 'LV', name: 'Latvia' },
        { code: 'LI', name: 'Liechtenstein' },
        { code: 'LT', name: 'Lithuania' },
        { code: 'LU', name: 'Luxembourg' },
        { code: 'MY', name: 'Malaysia' },
        { code: 'MT', name: 'Malta' },
        { code: 'MX', name: 'Mexico' },
        { code: 'NL', name: 'Netherlands' },
        { code: 'NZ', name: 'New Zealand' },
        { code: 'NG', name: 'Nigeria' },
        { code: 'NO', name: 'Norway' },
        { code: 'OM', name: 'Oman' },
        { code: 'PK', name: 'Pakistan' },
        { code: 'PA', name: 'Panama' },
        { code: 'PG', name: 'Papua New Guinea' },
        { code: 'PY', name: 'Paraguay' },
        { code: 'PE', name: 'Peru' },
        { code: 'PH', name: 'Philippines' },
        { code: 'PL', name: 'Poland' },
        { code: 'PT', name: 'Portugal' },
        { code: 'QA', name: 'Qatar' },
        { code: 'RO', name: 'Romania' },
        { code: 'RW', name: 'Rwanda' },
        { code: 'SA', name: 'Saudi Arabia' },
        { code: 'SG', name: 'Singapore' },
        { code: 'SK', name: 'Slovakia' },
        { code: 'SI', name: 'Slovenia' },
        { code: 'ZA', name: 'South Africa' },
        { code: 'KR', name: 'South Korea' },
        { code: 'ES', name: 'Spain' },
        { code: 'LK', name: 'Sri Lanka' },
        { code: 'SE', name: 'Sweden' },
        { code: 'CH', name: 'Switzerland' },
        { code: 'TW', name: 'Taiwan' },
        { code: 'TZ', name: 'Tanzania' },
        { code: 'TH', name: 'Thailand' },
        { code: 'TT', name: 'Trinidad and Tobago' },
        { code: 'TR', name: 'Turkey' },
        { code: 'UG', name: 'Uganda' },
        { code: 'AE', name: 'United Arab Emirates' },
        { code: 'UK', name: 'United Kingdom' },
        { code: 'US', name: 'United States' },
        { code: 'UY', name: 'Uruguay' },
        { code: 'VE', name: 'Venezuela' },
        { code: 'VN', name: 'Vietnam' },
        { code: 'OTHER', name: 'Other' }
    ];

    /**
     * Ensure the current Firebase Auth user has the ageVerified custom claim.
     * If not, show a self-declaration modal for age + country.
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

        // Check current token claims first (cached, no network)
        return auth.currentUser.getIdTokenResult(false).then(function(idTokenResult) {
            if (idTokenResult.claims.ageVerified === true) {
                return; // Already verified
            }

            // Cached token says not verified; force refresh to be sure before showing form
            return auth.currentUser.getIdTokenResult(true).then(function(freshResult) {
                if (freshResult.claims.ageVerified === true) {
                    return; // Verified after refresh
                }
                // Need to show self-declaration form
                return showSelfDeclarationForm(auth, options);
            });
        }).catch(function(err) {
            // KINDLE COMPATIBILITY: Some E-ink browsers fail token refresh due to
            // slow network or clock skew. Instead of hard-blocking, fall back to
            // the form so the user can still verify.
            console.warn('Age verification token check failed, falling back to form:', err);
            return showSelfDeclarationForm(auth, options);
        });
    }

    /**
     * Show the self-declaration modal and return a Promise.
     */
    function showSelfDeclarationForm(auth, options) {
        return new Promise(function(resolve, reject) {
            var existing = document.getElementById('rekindle-ageverif-modal');
            if (existing) existing.remove();

            var modal = document.createElement('div');
            modal.id = 'rekindle-ageverif-modal';
            modal.style.cssText =
                'position:fixed;top:0;left:0;width:100%;height:100%;' +
                'background:rgba(0,0,0,0.85);z-index:99999;' +
                'display:flex;align-items:center;justify-content:center;' +
                'font-family:"Courier New",Courier,monospace;' +
                'overflow-y:auto;padding:20px 0;box-sizing:border-box;';

            // Build country options
            var countryOptions = '<option value="">Select your country</option>';
            for (var i = 0; i < COUNTRIES.length; i++) {
                var c = COUNTRIES[i];
                countryOptions += '<option value="' + escapeHtml(c.code) + '">' + escapeHtml(c.name) + '</option>';
            }

            // Build day options
            var dayOptions = '<option value="">Day</option>';
            for (var d = 1; d <= 31; d++) {
                dayOptions += '<option value="' + d + '">' + d + '</option>';
            }

            // Build month options
            var monthOptions = '<option value="">Month</option>';
            var monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
            for (var m = 1; m <= 12; m++) {
                monthOptions += '<option value="' + m + '">' + monthNames[m - 1] + '</option>';
            }

            // Build year options (current year down to 100 years ago)
            var currentYear = new Date().getFullYear();
            var yearOptions = '<option value="">Year</option>';
            for (var y = currentYear; y >= currentYear - 100; y--) {
                yearOptions += '<option value="' + y + '">' + y + '</option>';
            }

            modal.innerHTML =
                '<style>' +
                '  #rekindle-ageverif-modal button:active, #rekindle-ageverif-modal #ageverif-home:active { transform:translate(2px,2px); box-shadow:none !important; background:#000 !important; color:#fff !important; }' +
                '  #rekindle-ageverif-modal select.ageverif-select { width:100%; padding:8px; border:2px solid #000; font-family:inherit; font-size:13px; background:#fff; box-sizing:border-box; -webkit-appearance:none; -moz-appearance:none; appearance:none; border-radius:0; }' +
                '  #rekindle-ageverif-modal .custom-select-container { width:100% !important; min-width:0 !important; }' +
                '  #rekindle-ageverif-modal .custom-select-trigger { width:100% !important; box-sizing:border-box !important; }' +
                '</style>' +
                '<div class="ageverif-window" style="background:#fff;border:2px solid #000;box-shadow:4px 4px 0 #000;max-width:380px;width:90%;display:flex;flex-direction:column;position:relative;font-family:Geneva,Verdana,sans-serif;">' +
                '  <div class="ageverif-title-bar" style="height:35px;border-bottom:2px solid #000;display:flex;align-items:center;justify-content:center;background:#fff;position:relative;flex-shrink:0;">' +
                '    <div class="ageverif-title-stripes" style="position:absolute;top:4px;bottom:4px;left:4px;right:4px;background-image:repeating-linear-gradient(0deg,transparent,transparent 2px,#000 3px,#000 4px);z-index:0;"></div>' +
                '    <div id="ageverif-home" title="Back to Home" style="position:absolute;left:10px;width:18px;height:18px;border:2px solid #000;background:#fff;z-index:2;cursor:pointer;display:flex;align-items:center;justify-content:center;font-weight:bold;font-family:sans-serif;font-size:0.9rem;line-height:1;box-shadow:2px 2px 0 #000;user-select:none;">X</div>' +
                '    <span style="background:#fff;padding:0 15px;font-weight:bold;font-size:1.1rem;z-index:1;">Age Verification</span>' +
                '  </div>' +
                '  <div style="padding:20px;text-align:left;">' +
                '    <div style="font-size:13px;margin-bottom:15px;line-height:1.5;">' +
                '      To access social features, please confirm your date of birth and country.' +
                '    </div>' +
                '    <div id="ageverif-error" style="display:none;color:#000;background:#ffcccc;border:2px solid #000;padding:8px;margin-bottom:12px;font-size:12px;font-weight:bold;"></div>' +
                '    <form id="ageverif-form">' +
                '      <label style="display:block;font-size:12px;font-weight:bold;margin-bottom:4px;">Date of Birth</label>' +
                '      <div style="display:flex;margin-bottom:10px;">' +
                '        <div style="flex:1;margin-right:6px;">' +
                '          <select id="ageverif-day" class="ageverif-select">' + dayOptions + '</select>' +
                '        </div>' +
                '        <div style="flex:2;margin-right:6px;">' +
                '          <select id="ageverif-month" class="ageverif-select">' + monthOptions + '</select>' +
                '        </div>' +
                '        <div style="flex:1;">' +
                '          <select id="ageverif-year" class="ageverif-select">' + yearOptions + '</select>' +
                '        </div>' +
                '      </div>' +
                '      <label style="display:block;font-size:12px;font-weight:bold;margin-bottom:4px;">Country / Region</label>' +
                '      <div style="display:flex;margin-bottom:10px;">' +
                '        <div style="flex:1;">' +
                '          <select id="ageverif-country" class="ageverif-select">' + countryOptions + '</select>' +
                '        </div>' +
                '      </div>' +
                '      <div style="font-size:11px;color:#555;margin-bottom:12px;line-height:1.4;">' +
                '        Providing false information may result in account suspension.' +
                '      </div>' +
                '      <button type="submit" id="ageverif-submit" style="width:100%;padding:10px;border:2px solid #000;background:#ddd;color:#000;font-family:inherit;font-size:14px;cursor:pointer;font-weight:bold;box-shadow:2px 2px 0 #000;">Confirm &amp; Continue</button>' +
                '    </form>' +
                (options.closable ? '    <button id="ageverif-close" style="width:100%;padding:10px;margin-top:10px;border:2px solid #000;background:#fff;color:#000;font-family:inherit;font-size:13px;cursor:pointer;font-weight:bold;box-shadow:2px 2px 0 #000;">Cancel</button>' : '') +
                '  </div>' +
                '</div>';

            document.body.appendChild(modal);

            // Initialize custom-select on the newly created dropdowns
            if (typeof initCustomSelects === 'function') {
                initCustomSelects();
            }

            // Home / back button
            document.getElementById('ageverif-home').addEventListener('click', function() {
                modal.remove();
                reject(new Error('Age verification was cancelled.'));
                window.location.href = 'index';
            });

            if (options.closable) {
                document.getElementById('ageverif-close').addEventListener('click', function() {
                    modal.remove();
                    reject(new Error('Age verification was cancelled.'));
                });
            }

            // Form submission
            document.getElementById('ageverif-form').addEventListener('submit', function(e) {
                e.preventDefault();
                var day = parseInt(document.getElementById('ageverif-day').value, 10);
                var month = parseInt(document.getElementById('ageverif-month').value, 10);
                var year = parseInt(document.getElementById('ageverif-year').value, 10);
                var country = document.getElementById('ageverif-country').value;
                var errorEl = document.getElementById('ageverif-error');

                if (!day || !month || !year) {
                    errorEl.textContent = 'Please select your full date of birth.';
                    errorEl.style.display = 'block';
                    return;
                }

                // Basic date validation
                var testDate = new Date(year, month - 1, day);
                if (testDate.getDate() !== day || testDate.getMonth() !== month - 1 || testDate.getFullYear() !== year) {
                    errorEl.textContent = 'Please enter a valid date of birth.';
                    errorEl.style.display = 'block';
                    return;
                }

                if (!country) {
                    errorEl.textContent = 'Please select your country.';
                    errorEl.style.display = 'block';
                    return;
                }

                // Check they are not from the future
                var now = new Date();
                if (testDate > now) {
                    errorEl.textContent = 'Date of birth cannot be in the future.';
                    errorEl.style.display = 'block';
                    return;
                }

                errorEl.style.display = 'none';
                var submitBtn = document.getElementById('ageverif-submit');
                submitBtn.textContent = 'Verifying...';
                submitBtn.disabled = true;

                var verifyFn = firebase.functions().httpsCallable('verifyAgeSelfDeclaration');
                verifyFn({ dob: { day: day, month: month, year: year }, country: country })
                    .then(function(result) {
                        var data = result.data;
                        if (data.success) {
                            modal.remove();
                            // Force token refresh to pick up the new custom claim
                            auth.currentUser.getIdToken(true).then(function() {
                                resolve();
                            }).catch(function() {
                                resolve(); // Token refresh failure is non-fatal
                            });
                        } else {
                            submitBtn.textContent = 'Confirm & Continue';
                            submitBtn.disabled = false;
                            errorEl.textContent = data.reason || 'You do not meet the minimum age requirement for your country.';
                            errorEl.style.display = 'block';
                        }
                    })
                    .catch(function(err) {
                        submitBtn.textContent = 'Confirm & Continue';
                        submitBtn.disabled = false;
                        errorEl.textContent = err.message || 'Verification failed. Please try again.';
                        errorEl.style.display = 'block';
                    });
            });
        });
    }

    function escapeHtml(text) {
        var div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Expose globally
    window.ensureAgeVerified = ensureAgeVerified;
})(window);
