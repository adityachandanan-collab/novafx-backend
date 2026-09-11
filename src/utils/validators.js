// Server-side is the SOURCE OF TRUTH for validation. The frontend check is a
// UX nicety only — every one of these rules is re-applied here because a
// request can always bypass the browser entirely (curl, Postman, a bot).

// Digits + at most one decimal point. Rejects letters, symbols, double dots,
// "100abc", empty strings, etc. Mirrors the frontend's validateNumber().
function validateNumber(raw, opts = {}) {
  const str = (raw ?? '').toString().trim();
  if (str === '') {
    return opts.allowEmpty ? { valid: true, value: null } : { valid: false, error: 'Required' };
  }
  const re = /^\d+(\.\d+)?$/;
  if (!re.test(str)) return { valid: false, error: 'Numbers only (e.g. 100.25)' };

  const num = parseFloat(str);
  if (!isFinite(num) || Number.isNaN(num)) return { valid: false, error: 'Invalid number' };

  const decimalPart = str.split('.')[1];
  if (opts.decimals != null && decimalPart && decimalPart.length > opts.decimals) {
    return { valid: false, error: `Max ${opts.decimals} decimal places` };
  }
  if (opts.min != null && num < opts.min) return { valid: false, error: `Minimum ${opts.min}` };
  if (opts.max != null && num > opts.max) return { valid: false, error: `Maximum ${opts.max}` };
  return { valid: true, value: num };
}

function validateEmail(raw) {
  const str = (raw ?? '').toString().trim().toLowerCase();
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!re.test(str)) return { valid: false, error: 'Invalid email address' };
  return { valid: true, value: str };
}

function validatePassword(raw) {
  const str = (raw ?? '').toString();
  if (str.length < 8) return { valid: false, error: 'Password must be at least 8 characters' };
  if (!/[A-Za-z]/.test(str) || !/[0-9]/.test(str)) {
    return { valid: false, error: 'Password must include letters and numbers' };
  }
  return { valid: true, value: str };
}

module.exports = { validateNumber, validateEmail, validatePassword };
