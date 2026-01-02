// Main Express server
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import Stripe from "stripe";
import { config } from "./config/index.js";

console.log("✅ Step 1: Imports loaded");

// Initialize Stripe
const stripeInstance = new Stripe(process.env.STRIPE_SECRET_KEY);

// Routes
import authRoutes from "./routes/auth.routes.js";
console.log("✅ Step 2: Auth routes imported");
import ga4Routes from "./routes/ga4.routes.js";
console.log("✅ Step 3: GA4 routes imported");
import insightsRoutes from "./routes/insights.routes.js";
console.log("✅ Step 4: Insights routes imported");
import stripeRoutes from "./routes/stripe.routes.js";
console.log("✅ Step 4.5: Stripe routes imported");
import schedulerRoutes from "./routes/scheduler.routes.js";
import emailPreferencesRoutes from "./routes/email-preferences.routes.js";
console.log("✅ Step 4.6: Email preferences routes imported");

// Scheduler
import {
  runNow as runSchedulerNow,
  startDailySchedule,
} from "./services/scheduler.service.js";
console.log("✅ Step 5: Scheduler imported");

const app = express();
app.set("trust proxy", 1); // Trust first proxy (Render)
console.log("✅ Step 6: Express app created");

// ==================================================
// STRIPE WEBHOOK - MUST BE BEFORE express.json()
// ==================================================
app.post(
  "/webhook/stripe",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;

    try {
      // Verify webhook signature
      event = stripeInstance.webhooks.constructEvent(
        req.body,
        sig,
        webhookSecret
      );
    } catch (err) {
      console.error("❌ Webhook signature verification failed:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    console.log(`🔔 Stripe webhook received: ${event.type}`);

    // Handle the event
    try {
      switch (event.type) {
        case "checkout.session.completed": {
          const session = event.data.object;
          const userId = session.metadata.supabase_user_id;
          const tier = session.metadata.subscription_tier;

          console.log(`✅ Payment successful for user ${userId}`);

          // Update user's subscription in database
          const { supabaseAdmin } = await import(
            "./services/supabase.service.js"
          );
          await supabaseAdmin
            .from("user_profiles")
            .update({
              subscription_tier: tier,
              subscription_status: "active",
              stripe_subscription_id: session.subscription,
            })
            .eq("id", userId);

          console.log(`✅ Updated user ${userId} to ${tier} tier`);
          break;
        }

        case "customer.subscription.updated": {
          const subscription = event.data.object;

          if (subscription.cancel_at_period_end) {
            console.log(`⚠️  Subscription will cancel: ${subscription.id}`);
          }
          break;
        }

        case "customer.subscription.deleted": {
          const subscription = event.data.object;
          const customerId = subscription.customer;

          // Downgrade user to starter tier
          const { supabaseAdmin } = await import(
            "./services/supabase.service.js"
          );
          await supabaseAdmin
            .from("user_profiles")
            .update({
              subscription_tier: "starter",
              subscription_status: "canceled",
            })
            .eq("stripe_customer_id", customerId);

          console.log(`⬇️  User downgraded to starter tier`);
          break;
        }

        default:
          console.log(`Unhandled event type: ${event.type}`);
      }

      res.json({ received: true });
    } catch (err) {
      console.error("❌ Error processing webhook:", err);
      res.status(500).send("Webhook processing failed");
    }
  }
);

// ==================================================
// SECURITY MIDDLEWARE
// ==================================================
app.use(helmet());

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps or curl)
      if (!origin) return callback(null, true);

      if (config.frontendUrls.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  })
);

// Rate limiting - stricter for production
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: config.nodeEnv === "production" ? 100 : 500,
  message: "Too many requests from this IP, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api/", limiter);

// Body parsing (AFTER Stripe webhook)
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

console.log("✅ Step 7: Middleware configured");

// ==================================================
// HEALTH CHECK
// ==================================================
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    environment: config.nodeEnv,
    version: "1.0.0",
  });
});

console.log("✅ Step 8: Health check registered");

// ==================================================
// API ROUTES
// ==================================================
console.log("⏳ Registering API routes...");

app.use("/api/auth", authRoutes);
console.log("  ✅ Auth routes registered");

app.use("/api/ga4", ga4Routes);
console.log("  ✅ GA4 routes registered");

app.use("/api/insights", insightsRoutes);
console.log("  ✅ Insights routes registered");

app.use("/api/stripe", stripeRoutes);
console.log("  ✅ Stripe routes registered");

app.use("/api/scheduler", schedulerRoutes);
console.log("  ✅ Scheduler routes registered");

app.use("/api/email-preferences", emailPreferencesRoutes);
console.log("  ✅ Email preferences routes registered");

// ==================================================
// ERROR HANDLERS
// ==================================================

// 404 handler
app.use((req, res) => {
  console.log(`⚠️  404 Not Found: ${req.method} ${req.url}`);
  res.status(404).json({
    error: "Route not found",
    path: req.url,
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error("❌ Server error:", err);

  const errorResponse = {
    error: "Internal server error",
  };

  if (config.nodeEnv === "development") {
    errorResponse.message = err.message;
    errorResponse.stack = err.stack;
  }

  res.status(err.status || 500).json(errorResponse);
});

console.log("✅ Step 9: Error handlers registered");

// ==================================================
// START SERVER
// ==================================================
const PORT = config.port;
console.log(`⏳ Starting server on port ${PORT}...`);

app.listen(PORT, () => {
  console.log("\n" + "=".repeat(60));
  console.log(`🚀 GOBBLEDATA SERVER RUNNING`);
  console.log(`📊 Environment: ${config.nodeEnv}`);
  console.log(`🔗 Port: ${PORT}`);
  console.log(`🌐 Frontend: ${config.frontendUrl}`);
  console.log("=".repeat(60));

  console.log("\n📍 Available Routes:");
  console.log("  GET  /health");
  console.log("  POST /webhook/stripe");
  if (config.nodeEnv === "development") {
    console.log("  POST /api/scheduler/run-now (DEV ONLY)");
  }
  console.log("  *    /api/auth/*");
  console.log("  *    /api/ga4/*");
  console.log("  *    /api/insights/*");
  console.log("  *    /api/stripe/*");

  console.log("\n" + "=".repeat(60) + "\n");

  console.log("✅ Server ready to accept connections\n");

  console.log("✅ Server ready to accept connections\n");

  // 🦃 START THE CRON JOB SCHEDULER
  startDailySchedule();
  console.log("✅ Daily insights scheduler started (runs hourly)\n");
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("⚠️  SIGTERM received, shutting down gracefully...");
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("\n⚠️  SIGINT received, shutting down gracefully...");
  process.exit(0);
});
