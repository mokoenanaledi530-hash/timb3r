/**
 * ========================================
 * TIMB3R Payment Screen Handler
 * ========================================
 * Manages all payment-related interactions:
 * - Bank transfers
 * - Button click handlers
 * - Form validation
 * - Error handling
 * ========================================
 */

// ===== PAYMENT STATE =====
const paymentState = {
  isProcessing: false,
  currentAmount: 0,
  profileId: null,
  bankDetails: null
};

/**
 * Initialize payment screen
 */
async function initPaymentScreen() {
  try {
    if (!token()) {
      console.warn('Payment screen requires authentication');
      return;
    }

    // Fetch bank details and profile ID
    await loadBankDetails();
    setupPaymentFormListeners();
    setupDepositButtonListener();

  } catch (error) {
    console.error('Payment screen initialization failed:', error);
    showPaymentError('Failed to initialize payment screen. Please refresh.');
  }
}

/**
 * Load bank payment details with profile ID
 */
async function loadBankDetails() {
  try {
    const response = await fetch('/api/payments/bank-details', {
      headers: headers()
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    paymentState.bankDetails = data;
    paymentState.profileId = data.profileId;

    // Update UI with bank details
    updateBankDetailsDisplay(data);

  } catch (error) {
    console.error('Failed to load bank details:', error);
    showPaymentError('Unable to load bank details. Please try again.');
  }
}

/**
 * Update bank details display on the page
 */
function updateBankDetailsDisplay(details) {
  const bankDetailsEl = document.getElementById('bankDetails');
  
  if (!bankDetailsEl) return;

  bankDetailsEl.innerHTML = `
    <div class="payment-details-card">
      <div class="detail-row">
        <label>Bank:</label>
        <span class="detail-value">${escapeHtml(details.bank)}</span>
      </div>
      <div class="detail-row">
        <label>Account Name:</label>
        <span class="detail-value">${escapeHtml(details.accountName)}</span>
      </div>
      <div class="detail-row">
        <label>Account Number:</label>
        <span class="detail-value mono">${escapeHtml(details.accountNumber)}</span>
      </div>
      <div class="detail-row">
        <label>Branch Code:</label>
        <span class="detail-value mono">${escapeHtml(details.branchCode)}</span>
      </div>
      <div class="detail-row highlight">
        <label>Reference/Profile ID:</label>
        <span class="detail-value mono strong">${escapeHtml(details.profileId)}</span>
        <button class="copy-btn" onclick="copyToClipboard('${details.profileId}', event)">
          Copy
        </button>
      </div>
    </div>
  `;
}

/**
 * Setup payment form listeners
 */
function setupPaymentFormListeners() {
  const bankPaymentForm = document.getElementById('bankPaymentForm');
  
  if (!bankPaymentForm) return;

  bankPaymentForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    await handleBankPaymentSubmit();
  });

  // Real-time validation
  const amountInput = document.getElementById('paymentAmount');
  if (amountInput) {
    amountInput.addEventListener('input', (e) => {
      validateAmountInput(e.target);
    });
  }
}

/**
 * Setup demo deposit button listener
 */
function setupDepositButtonListener() {
  const demoDepositBtn = document.getElementById('demoDepositBtn');
  
  if (demoDepositBtn) {
    demoDepositBtn.addEventListener('click', demoDeposit);
  }
}

/**
 * Validate amount input
 */
function validateAmountInput(input) {
  const amount = Number(input.value);
  const error = document.getElementById('amountError');
  
  if (!error) return;

  if (input.value === '') {
    error.textContent = '';
    return;
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    error.textContent = 'Please enter a valid amount';
    input.classList.add('input-error');
  } else if (amount < 500) {
    error.textContent = 'Minimum amount is R500';
    input.classList.add('input-warning');
  } else {
    error.textContent = '';
    input.classList.remove('input-error', 'input-warning');
  }
}

/**
 * Handle bank payment form submission
 */
async function handleBankPaymentSubmit() {
  try {
    // Reset previous errors
    clearPaymentErrors();

    // Validate form
    const validationErrors = validateBankPaymentForm();
    if (validationErrors.length > 0) {
      displayFormErrors(validationErrors);
      return;
    }

    // Get form data
    const formData = getBankPaymentFormData();

    // Prevent double submission
    if (paymentState.isProcessing) {
      showPaymentError('Payment is already being processed. Please wait...');
      return;
    }

    paymentState.isProcessing = true;
    const submitBtn = document.getElementById('bankPaymentSubmitBtn');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Submitting...';
    }

    // Submit payment
    const response = await fetch('/api/payments/bank', {
      method: 'POST',
      headers: {
        ...headers(),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(formData)
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Payment submission failed');
    }

    // Success
    showPaymentSuccess(
      'Payment submitted successfully! ' +
      'Reference: ' + (data.payment?.profile_reference || 'N/A')
    );

    // Reset form
    document.getElementById('bankPaymentForm')?.reset();
    paymentState.currentAmount = 0;

  } catch (error) {
    console.error('Bank payment submission error:', error);
    showPaymentError(
      error.message || 'Failed to submit payment. Please try again.'
    );
  } finally {
    paymentState.isProcessing = false;
    const submitBtn = document.getElementById('bankPaymentSubmitBtn');
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit Payment';
    }
  }
}

/**
 * Validate bank payment form
 */
function validateBankPaymentForm() {
  const errors = [];

  const amount = Number(document.getElementById('paymentAmount')?.value);
  if (!Number.isFinite(amount) || amount <= 0) {
    errors.push('Please enter a valid payment amount');
  }
  if (amount < 500) {
    errors.push('Minimum payment amount is R500');
  }

  const senderName = document.getElementById('senderName')?.value?.trim();
  if (!senderName) {
    errors.push('Sender name is required');
  }

  const paymentDate = document.getElementById('paymentDate')?.value;
  if (!paymentDate) {
    errors.push('Payment date is required');
  }

  return errors;
}

/**
 * Get bank payment form data
 */
function getBankPaymentFormData() {
  return {
    amount: Number(document.getElementById('paymentAmount').value),
    senderName: document.getElementById('senderName')?.value?.trim() || null,
    senderBank: document.getElementById('senderBank')?.value?.trim() || null,
    paymentDate: document.getElementById('paymentDate')?.value || null,
    proofUrl: document.getElementById('proofUrl')?.value?.trim() || null
  };
}

/**
 * Display form validation errors
 */
function displayFormErrors(errors) {
  const errorContainer = document.getElementById('formErrors');
  
  if (!errorContainer) {
    showPaymentError(errors.join('\n'));
    return;
  }

  errorContainer.innerHTML = errors
    .map(error => `<div class="error-message">• ${escapeHtml(error)}</div>`)
    .join('');
  errorContainer.style.display = 'block';
}

/**
 * Clear payment errors
 */
function clearPaymentErrors() {
  const errorContainer = document.getElementById('formErrors');
  if (errorContainer) {
    errorContainer.innerHTML = '';
    errorContainer.style.display = 'none';
  }
}

/**
 * Show payment error message
 */
function showPaymentError(message) {
  const statusEl = document.getElementById('paymentStatus');
  
  if (statusEl) {
    statusEl.className = 'status-box show status-error';
    statusEl.textContent = message;
  } else {
    alert('Error: ' + message);
  }
}

/**
 * Show payment success message
 */
function showPaymentSuccess(message) {
  const statusEl = document.getElementById('paymentStatus');
  
  if (statusEl) {
    statusEl.className = 'status-box show status-success';
    statusEl.innerHTML = `<span class="success-text">✓</span> ${escapeHtml(message)}`;
  } else {
    alert('Success: ' + message);
  }
}

/**
 * Demo deposit handler
 */
async function demoDeposit() {
  try {
    clearPaymentErrors();

    const btn = event?.currentTarget;
    if (btn) btn.disabled = true;

    const statusEl = document.getElementById('depositMsg') || document.getElementById('paymentStatus');

    if (statusEl) {
      statusEl.className = 'status-box show status-info';
      statusEl.textContent = 'Processing demo deposit...';
    }

    const response = await fetch('/api/deposits', {
      method: 'POST',
      headers: {
        ...headers(),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ amount: 1000 })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Demo deposit failed');
    }

    // Success
    if (statusEl) {
      statusEl.className = 'status-box show status-success';
      statusEl.innerHTML = `
        <span class="success-text">✓ Demo Deposit Successful</span>
        <br>Reference: <strong>${escapeHtml(data.reference)}</strong>
        <br>Amount: <strong>R1,000.00</strong>
      `;
    }

    // Reload dashboard
    await load();

  } catch (error) {
    console.error('Demo deposit error:', error);
    showPaymentError(error.message || 'Demo deposit failed. Please try again.');
  } finally {
    const btn = event?.currentTarget;
    if (btn) btn.disabled = false;
  }
}

/**
 * Copy to clipboard helper
 */
function copyToClipboard(text, event) {
  event.preventDefault();
  event.stopPropagation();

  navigator.clipboard.writeText(text).then(() => {
    const btn = event.target;
    const originalText = btn.textContent;
    btn.textContent = 'Copied!';
    btn.classList.add('copied');

    setTimeout(() => {
      btn.textContent = originalText;
      btn.classList.remove('copied');
    }, 2000);
  }).catch(() => {
    alert('Failed to copy. Please try again.');
  });
}

/**
 * Escape HTML for safety
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Format currency display
 */
function formatCurrency(amount) {
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR'
  }).format(Number(amount || 0));
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPaymentScreen);
} else {
  initPaymentScreen();
}
