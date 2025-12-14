// Main Express server
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { config } from "./config/index.js";

console.log("✅ Step 1: Imports loaded");

// Routes
import authRoutes from "./routes/auth.routes.js";
console.log("✅ Step 2: Auth routes imported");

import ga4Routes from "./routes/ga4.routes.js";
console.log("✅ Step 3: GA4 routes imported");

import insightsRoutes from "./routes/insights.routes.js";
console.log("✅ Step 4: Insights routes imported");

const app = express();
console.log("✅ Step 5: Express app created");

// Security middleware
app.use(helmet());
app.use(
  cors({
    origin: config.frontendUrl,
    credentials: true,
  })
);

// Rate limiting
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: "Too many requests, please try again later.",
});
app.use("/api/", limiter);

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

console.log("✅ Step 6: Middleware configured");

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    environment: config.nodeEnv,
  });
});

console.log("✅ Step 7: Health check registered");

// API Routes
console.log("⏳ Registering API routes...");
app.use("/api/auth", authRoutes);
console.log("  ✅ Auth routes registered");

app.use("/api/ga4", ga4Routes);
console.log("  ✅ GA4 routes registered");
console.log("  📊 GA4 router stack length:", ga4Routes.stack.length);

app.use("/api/insights", insightsRoutes);
console.log("  ✅ Insights routes registered");

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// Error handler
app.use((err, req, res, next) => {
  console.error("Server error:", err);
  res.status(500).json({
    error: "Internal server error",
    message: config.nodeEnv === "development" ? err.message : undefined,
  });
});

console.log("✅ Step 8: Error handlers registered");

// Start server
const PORT = config.port;
console.log("⏳ Starting server on port", PORT, "...");

app.listen(PORT, () => {
  console.log("\n" + "=".repeat(50));
  console.log(`🚀 SERVER IS RUNNING ON PORT ${PORT}`);
  console.log(`📊 Environment: ${config.nodeEnv}`);
  console.log(`🔗 Frontend URL: ${config.frontendUrl}`);
  console.log("=".repeat(50));

  console.log("\n📍 Registered GA4 Routes:");
  console.log("Total routes in stack:", ga4Routes.stack.length);

  ga4Routes.stack.forEach((layer, index) => {
    if (layer.route) {
      const method = Object.keys(layer.route.methods)[0].toUpperCase();
      console.log(`  ${method} /api/ga4${layer.route.path}`);
    }
  });

  console.log("\n" + "=".repeat(50) + "\n");
});
