// GA4 Routes - OAuth flow and property management
import express from "express";
import { authenticateUser } from "../middleware/auth.middleware.js";
import { ga4Service } from "../services/ga4.service.js";
import {
  supabaseService,
  supabaseAdmin,
} from "../services/supabase.service.js";
import { config } from "../config/index.js";
import * as emailService from "../services/email.service.js";

const router = express.Router();

// TEMPORARY DEBUG ROUTE
router.get("/test/hello", (req, res) => {
  res.json({ message: "Hello from test route!" });
});

/**
 * ROUTE 1: Start OAuth flow
 * GET /api/ga4/connect
 */
router.get("/connect", async (req, res) => {
  try {
    // Get token from query param (temporary for testing)
    const token =
      req.query.token || req.headers.authorization?.replace("Bearer ", "");

    if (!token) {
      return res.status(401).json({ error: "No token provided" });
    }

    // Verify token
    const { supabaseAdmin } = await import("../services/supabase.service.js");
    const {
      data: { user },
      error,
    } = await supabaseAdmin.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({ error: "Invalid token" });
    }

    const userId = user.id;

    // Generate Google OAuth URL
    const authUrl = ga4Service.getAuthUrl(userId);

    console.log("🔗 OAuth URL generated for user:", userId);

    // Redirect user to Google
    res.redirect(authUrl);
  } catch (error) {
    console.error("Connect error:", error);
    res.status(500).json({ error: "Failed to initiate OAuth flow" });
  }
});

/**
 * ROUTE 2: Handle OAuth callback
 * GET /api/ga4/callback?code=xyz&state=userId
 */
router.get("/callback", async (req, res) => {
  try {
    const { code, state: userId } = req.query;

    if (!code) {
      return res.redirect(`${config.frontendUrl}/dashboard?error=no_code`);
    }

    console.log("📥 OAuth callback received for user:", userId);

    // Exchange code for tokens
    const tokens = await ga4Service.getTokensFromCode(code);

    if (!tokens.access_token) {
      return res.redirect(`${config.frontendUrl}/dashboard?error=no_token`);
    }

    console.log("✅ Tokens received");

    // Fetch user's GA4 properties
    // Fetch user's GA4 properties
    let properties;
    try {
      properties = await ga4Service.getGA4Properties(tokens.access_token);
    } catch (propertyError) {
      console.error("❌ Error fetching properties:", propertyError.message);
      // If no properties found, that's okay - continue anyway
      properties = [];
    }

    if (!properties || properties.length === 0) {
      console.log("⚠️  No GA4 properties found - user needs to set one up");
      return res.redirect(
        `${config.frontendUrl}/dashboard?error=no_ga4_properties&message=No GA4 properties found. Please set one up in Google Analytics.`
      );
    }

    console.log(`📊 Found ${properties.length} GA4 properties`);

    // For MVP: Just use first property
    const firstProperty = properties[0];

    // Save connection to database

    const { data, error } = await supabaseAdmin
      .from("ga4_connections")
      .upsert(
        {
          user_id: userId,
          property_id: firstProperty.propertyId,
          property_name: firstProperty.propertyName,
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          token_expires_at: new Date(
            Date.now() + (tokens.expiry_date || 3600000)
          ).toISOString(),
          is_active: true,
          last_synced_at: new Date().toISOString(),
        },
        {
          onConflict: "user_id,property_id",
        }
      )
      .select()
      .single();

    if (error) {
      console.error("Database error:", error);
      return res.redirect(`${config.frontendUrl}/dashboard?error=db_error`);
    }

    console.log("💾 Connection saved to database");

    // Redirect back to dashboard with success
    res.redirect(
      `${
        config.frontendUrl
      }/dashboard?ga4_connected=true&property=${encodeURIComponent(
        firstProperty.propertyName
      )}`
    );
  } catch (error) {
    console.error("Callback error:", error);
    res.redirect(`${config.frontendUrl}/dashboard?error=callback_failed`);
  }
});

/**
 * ROUTE 3: Get user's connected properties
 * GET /api/ga4/properties
 */
router.get("/properties", authenticateUser, async (req, res) => {
  try {
    const connections = await supabaseService.getGA4Connections(req.user.id);
    res.json({ connections });
  } catch (error) {
    console.error("Get properties error:", error);
    res.status(500).json({ error: "Failed to fetch properties" });
  }
});

/**
 * ROUTE 4: Disconnect GA4 property
 * DELETE /api/ga4/disconnect/:connectionId
 */
router.delete(
  "/disconnect/:connectionId",
  authenticateUser,
  async (req, res) => {
    try {
      const { connectionId } = req.params;
      const userId = req.user.id;

      const { supabaseAdmin } = await import("../services/supabase.service.js");
      const { error } = await supabaseAdmin
        .from("ga4_connections")
        .update({ is_active: false })
        .eq("id", connectionId)
        .eq("user_id", userId); // Ensure user owns this connection

      if (error) throw error;

      res.json({ success: true, message: "Property disconnected" });
    } catch (error) {
      console.error("Disconnect error:", error);
      res.status(500).json({ error: "Failed to disconnect property" });
    }
  }
);

// Testing Routes
/**
 * TEST ROUTE: Fetch metrics from connected property (with auto-refresh)
 * GET /api/ga4/test/fetch-metrics?userId=YOUR_USER_ID
 */
router.get("/test/fetch-metrics", async (req, res) => {
  try {
    const userId = req.query.userId;

    if (!userId) {
      return res.json({ error: "Add ?userId=YOUR_USER_ID to the URL" });
    }

    // Get user's connection
    const connections = await supabaseService.getGA4Connections(userId);

    if (!connections || connections.length === 0) {
      return res.json({ error: "No GA4 connection found" });
    }

    let connection = connections[0];
    let accessToken = connection.access_token;

    // Check if token is expired
    const tokenExpiry = new Date(connection.token_expires_at);
    const now = new Date();

    console.log("🔍 Token expiry check:");
    console.log("  Token expires at:", tokenExpiry);
    console.log("  Current time:", now);
    console.log("  Is expired?", now >= tokenExpiry);

    if (now >= tokenExpiry) {
      console.log("🔄 Access token expired, refreshing...");

      try {
        // Refresh the token
        const newTokens = await ga4Service.refreshAccessToken(
          connection.refresh_token
        );

        // Update database with new tokens
        const { error } = await supabaseAdmin
          .from("ga4_connections")
          .update({
            access_token: newTokens.access_token,
            token_expires_at: new Date(newTokens.expiry_date).toISOString(),
            refresh_token: newTokens.refresh_token || connection.refresh_token, // Keep old one if not provided
          })
          .eq("id", connection.id);

        if (error) {
          console.error("Failed to update tokens:", error);
        } else {
          console.log("✅ Token refreshed and saved");
          accessToken = newTokens.access_token;
        }
      } catch (refreshError) {
        console.error("❌ Token refresh failed:", refreshError);
        return res.status(401).json({
          error: "Token refresh failed - user needs to reconnect",
          needsReconnect: true,
        });
      }
    }

    console.log(`📊 Fetching metrics for ${connection.property_name}...`);

    // Fetch last 7 days of data
    const metrics = await ga4Service.fetchMetrics(
      connection.property_id,
      accessToken,
      {
        startDate: "7daysAgo",
        endDate: "yesterday",
      }
    );

    res.json({
      success: true,
      property: {
        id: connection.property_id,
        name: connection.property_name,
      },
      metrics,
    });
  } catch (error) {
    console.error("Fetch metrics error:", error);
    res.status(500).json({
      error: error.message,
      needsRefresh: error.message.includes("expired"),
    });
  }
});

// ... existing test/fetch-metrics route stays here ...

/**
 * TEMP: Manually refresh token
 * GET /api/ga4/force-refresh?userId=YOUR_USER_ID
 */
/**
 * TEMP: Manually refresh token
 * GET /api/ga4/force-refresh?userId=YOUR_USER_ID
 */
router.get("/force-refresh", async (req, res) => {
  try {
    const userId = req.query.userId;

    if (!userId) {
      return res.json({ error: "Add ?userId=YOUR_USER_ID to the URL" });
    }

    const connections = await supabaseService.getGA4Connections(userId);

    if (!connections || connections.length === 0) {
      return res.json({ error: "No connection found" });
    }

    const connection = connections[0];

    console.log("🔄 Forcing token refresh...");

    const newTokens = await ga4Service.refreshAccessToken(
      connection.refresh_token
    );

    // Calculate correct expiry (3600 seconds = 1 hour)
    const expiresAt = new Date(
      Date.now() + (newTokens.expires_in || 3600) * 1000
    ).toISOString();

    console.log("📅 New token expires at:", expiresAt);

    const { error } = await supabaseAdmin
      .from("ga4_connections")
      .update({
        access_token: newTokens.access_token,
        token_expires_at: expiresAt,
      })
      .eq("id", connection.id);

    if (error) throw error;

    res.json({
      success: true,
      message: "Token refreshed successfully",
      expiresAt,
    });
  } catch (error) {
    console.error("Force refresh error:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * TEST ROUTE: Analyze metrics and detect anomalies
 * GET /api/ga4/test/analyze?userId=YOUR_USER_ID
 */
router.get("/test/analyze", async (req, res) => {
  try {
    const userId = req.query.userId;

    if (!userId) {
      return res.json({ error: "Add ?userId=YOUR_USER_ID to the URL" });
    }

    // Get connection
    const connections = await supabaseService.getGA4Connections(userId);

    if (!connections || connections.length === 0) {
      return res.json({ error: "No connection found" });
    }

    const connection = connections[0];

    console.log(
      `📊 Fetching and analyzing metrics for ${connection.property_name}...`
    );

    // Fetch metrics
    const metrics = await ga4Service.fetchMetrics(
      connection.property_id,
      connection.access_token,
      {
        startDate: "7daysAgo",
        endDate: "yesterday",
      }
    );

    if (!metrics.hasData) {
      return res.json({ error: "No data available" });
    }

    // Import insights service
    const { insightsService } = await import("../services/insights.service.js");

    // Analyze for anomalies
    const insights = await insightsService.analyzeMetrics(metrics.daily);

    res.json({
      success: true,
      property: connection.property_name,
      dataPoints: metrics.daily.length,
      insights: insights,
      topThree: insights.slice(0, 3), // Top 3 insights
    });
  } catch (error) {
    console.error("Analyze error:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * TEST ROUTE: Analyze and save insights
 * GET /api/ga4/test/save-insights?userId=YOUR_USER_ID
 */
router.get("/test/save-insights", async (req, res) => {
  try {
    const userId = req.query.userId;

    if (!userId) {
      return res.json({ error: "Add ?userId=YOUR_USER_ID to the URL" });
    }

    // Get connection
    const connections = await supabaseService.getGA4Connections(userId);

    if (!connections || connections.length === 0) {
      return res.json({ error: "No connection found" });
    }

    const connection = connections[0];

    console.log(`📊 Fetching metrics for ${connection.property_name}...`);

    // Fetch metrics
    const metrics = await ga4Service.fetchMetrics(
      connection.property_id,
      connection.access_token,
      {
        startDate: "7daysAgo",
        endDate: "yesterday",
      }
    );

    if (!metrics.hasData) {
      return res.json({ error: "No data available" });
    }

    // Import insights service
    const { insightsService } = await import("../services/insights.service.js");

    // Analyze for anomalies
    const insights = await insightsService.analyzeMetrics(metrics.daily);

    console.log(`🔍 Detected ${insights.length} insights`);

    // Save to database
    const saveResult = await supabaseService.saveInsights(
      userId,
      connection.id, // ← ADDED connection ID
      insights
    );

    res.json({
      success: true,
      property: connection.property_name,
      analyzed: metrics.daily.length,
      detected: insights.length,
      saved: saveResult.saved,
      insights: saveResult.insights,
    });
  } catch (error) {
    console.error("Save insights error:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * TEST ROUTE: Send email with real insights from database
 * GET /api/ga4/test/send-email?userId=YOUR_USER_ID
 */
router.get("/test/send-email", async (req, res) => {
  try {
    const userId = req.query.userId || "d92c6c05-5899-4e62-a90b-1d6cc0f506e0";

    console.log("📧 Testing email send for user:", userId);

    // Get latest insights from database
    const { data: insights, error } = await supabaseAdmin
      .from("daily_insights")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(3);

    if (error) {
      throw error;
    }

    if (!insights || insights.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No insights found for user. Run /test/save-insights first.",
      });
    }

    console.log(`📊 Found ${insights.length} insights to send`);

    // Send email
    const result = await emailService.sendDailyInsights(userId, insights);

    res.json({
      success: result.success,
      message: result.message,
      emailId: result.emailId,
      recipient: result.recipient,
      insightCount: insights.length,
    });
  } catch (error) {
    console.error("❌ Email test error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * TEST ROUTE: Send simple test email (doesn't require database)
 * GET /api/ga4/test/send-simple-email?email=YOUR_EMAIL
 */
router.get("/test/send-simple-email", async (req, res) => {
  try {
    const email = req.query.email || "luvntruth77@gmail.com";

    console.log("📧 Sending simple test email to:", email);

    const result = await emailService.sendTestEmail(email);

    res.json(result);
  } catch (error) {
    console.error("❌ Simple email test error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Test route for manually running the daily insights job
router.get("/test/run-daily-job", async (req, res) => {
  try {
    console.log("[Test] Manually triggering daily insights job...");

    const { runNow } = await import("../services/scheduler.service.js");
    const result = await runNow();

    res.json({
      success: true,
      message: "Daily insights job completed",
      ...result,
    });
  } catch (error) {
    console.error("[Test] Error running daily job:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// TEMP: Check active connections
router.get("/test/check-connections", async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from("ga4_connections")
    .select("*")
    .eq("is_active", true);

  res.json({
    activeConnections: data?.length || 0,
    connections: data,
    error: error,
  });
});

// Test GA4 connection (DEV ONLY)
router.get("/test-fetch/:connectionId", async (req, res) => {
  try {
    const { connectionId } = req.params;

    // Get connection
    const { data: connection } = await supabaseAdmin
      .from("ga4_connections")
      .select("*")
      .eq("id", connectionId)
      .single();

    if (!connection) {
      return res.status(404).json({ error: "Connection not found" });
    }

    console.log("🔍 Testing GA4 fetch with:");
    console.log("  Property ID:", connection.property_id);
    console.log("  Token expires:", connection.token_expires_at);

    // Try to fetch metrics
    const { ga4Service } = await import("../services/ga4.service.js");
    const metrics = await ga4Service.fetchMetrics(
      connection.property_id,
      connection.access_token,
      {
        startDate: "7daysAgo",
        endDate: "yesterday",
      }
    );

    res.json({
      success: true,
      hasData: metrics?.hasData,
      dailyCount: metrics?.daily?.length,
      sample: metrics?.daily?.[0],
    });
  } catch (error) {
    console.error("❌ GA4 test error:", error);
    res.status(500).json({
      error: error.message,
      stack: error.stack,
    });
  }
});

export default router;
