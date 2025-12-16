// Subscription tier definitions and limits
const SUBSCRIPTION_TIERS = {
  starter: {
    name: 'Starter',
    price: 0,
    limits: {
      properties: 1,
      lookbackDays: 14,
      reportsPerWeek: 1, // Weekly only
      customTimezone: true,
      pdfExports: false,
      historicalComparison: false,
      slackAlerts: false,
      supportLevel: 'docs'
    }
  },
  growth: {
    name: 'Growth',
    price: 39,
    limits: {
      properties: 3,
      lookbackDays: 30,
      reportsPerDay: 1, // Daily
      customTimezone: true,
      pdfExports: true,
      historicalComparison: true,
      slackAlerts: false,
      supportLevel: 'email-48hr'
    }
  },
  pro: {
    name: 'Pro',
    price: 79,
    limits: {
      properties: 10,
      lookbackDays: 60,
      reportsPerDay: 3, // Up to 3x daily
      customTimezone: true,
      pdfExports: true,
      historicalComparison: true,
      slackAlerts: true,
      supportLevel: 'email-24hr'
    }
  },
  enterprise: {
    name: 'Enterprise',
    price: 199,
    limits: {
      properties: 999, // "Unlimited"
      lookbackDays: 90,
      reportsPerDay: 24, // Hourly if needed
      customTimezone: true,
      pdfExports: true,
      historicalComparison: true,
      slackAlerts: true,
      whiteLabel: true,
      supportLevel: 'dedicated-4hr'
    }
  }
};

// Check if user can add another property
function canAddProperty(subscriptionTier, currentPropertyCount) {
  const tier = SUBSCRIPTION_TIERS[subscriptionTier] || SUBSCRIPTION_TIERS.starter;
  return currentPropertyCount < tier.limits.properties;
}

// Check if user can access a feature
function hasFeatureAccess(subscriptionTier, featureName) {
  const tier = SUBSCRIPTION_TIERS[subscriptionTier] || SUBSCRIPTION_TIERS.starter;
  return tier.limits[featureName] === true;
}

// Get lookback days for tier
function getLookbackDays(subscriptionTier) {
  const tier = SUBSCRIPTION_TIERS[subscriptionTier] || SUBSCRIPTION_TIERS.starter;
  return tier.limits.lookbackDays;
}

module.exports = {
  SUBSCRIPTION_TIERS,
  canAddProperty,
  hasFeatureAccess,
  getLookbackDays
};