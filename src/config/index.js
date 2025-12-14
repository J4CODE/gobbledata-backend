// Configuration - loads environment variables
import dotenv from "dotenv";
dotenv.config();

export const config = {
  // Server
  port: process.env.PORT || 3001,
  nodeEnv: process.env.NODE_ENV || "development",
  frontendUrl: process.env.FRONTEND_URL || "http://localhost:5173",

  // Supabase
  supabase: {
    url: process.env.SUPABASE_URL,
    anonKey: process.env.SUPABASE_ANON_KEY,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  },

  // Google Analytics 4
  ga4: {
    clientId: process.env.GA4_CLIENT_ID,
    clientSecret: process.env.GA4_CLIENT_SECRET,
    redirectUri: process.env.GA4_REDIRECT_URI,
  },

  // Email
  email: {
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || "587"),
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.EMAIL_FROM || "insights@gobbledata.com",
  },

  // Stripe
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  },

  // Algorithm thresholds (from our research!)
  algorithm: {
    thresholds: {
      conversions: 0.2, // 20% change
      revenue: 0.2,
      conversionRate: 0.15,
      sessions: 0.3,
      users: 0.3,
      bounceRate: 0.35,
      engagementRate: 0.35,
    },
    persistence: {
      window: 5, // 5-day window
      required: 3, // Must be anomalous 3+ days
    },
    minSampleSize: 100, // Need 100+ sessions/day
  },
};

// Debug: verify GA4 config is loading
console.log("🔍 GA4 Config Check:");
console.log("Client ID:", config.ga4.clientId ? "SET ✓" : "MISSING ✗");
console.log("Client Secret:", config.ga4.clientSecret ? "SET ✓" : "MISSING ✗");
console.log("Redirect URI:", config.ga4.redirectUri);
