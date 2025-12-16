// Anti-fraud validation middleware
const supabase = require('../config/supabase');

// Check if IP has too many signup attempts
async function checkIPRateLimit(ip) {
  const { data, error } = await supabase
    .from('signup_attempts')
    .select('*')
    .eq('ip_address', ip)
    .gte('created_at', new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()) // Last 90 days
    .eq('success', true);

  if (error) {
    console.error('IP rate limit check error:', error);
    return { allowed: true, count: 0 }; // Fail open
  }

  return {
    allowed: data.length < 3, // Max 3 accounts per IP in 90 days
    count: data.length
  };
}

// Validate GA4 property has real traffic
async function validateGA4Property(propertyId, accessToken) {
  // This will be enhanced later with actual GA4 API check
  // For now, just check if property_id is not empty
  if (!propertyId || propertyId.trim().length === 0) {
    return { valid: false, reason: 'Invalid property ID' };
  }

  // TODO: Add GA4 API call to check for >100 sessions in last 30 days
  return { valid: true };
}

// Check for disposable email domains
function isDisposableEmail(email) {
  const disposableDomains = [
    'tempmail.com',
    'throwaway.email',
    'guerrillamail.com',
    '10minutemail.com',
    'mailinator.com',
    'trashmail.com'
  ];

  const domain = email.split('@')[1]?.toLowerCase();
  return disposableDomains.includes(domain);
}

// Log signup attempt
async function logSignupAttempt(email, ip, fingerprint, success) {
  const { error } = await supabase
    .from('signup_attempts')
    .insert({
      email,
      ip_address: ip,
      device_fingerprint: fingerprint,
      success
    });

  if (error) {
    console.error('Failed to log signup attempt:', error);
  }
}

// Main validation function
async function validateSignup(req, res, next) {
  const { email } = req.body;
  const ip = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  const fingerprint = req.body.deviceFingerprint || null;

  // Check disposable email
  if (isDisposableEmail(email)) {
    await logSignupAttempt(email, ip, fingerprint, false);
    return res.status(400).json({
      error: 'Disposable email addresses are not allowed. Please use a permanent email.'
    });
  }

  // Check IP rate limit
  const ipCheck = await checkIPRateLimit(ip);
  if (!ipCheck.allowed) {
    await logSignupAttempt(email, ip, fingerprint, false);
    return res.status(429).json({
      error: 'Too many accounts created from this location. Please contact support.'
    });
  }

  // Store IP for later use
  req.signupIP = ip;
  req.deviceFingerprint = fingerprint;

  next();
}

module.exports = {
  validateSignup,
  validateGA4Property,
  logSignupAttempt,
  checkIPRateLimit
};