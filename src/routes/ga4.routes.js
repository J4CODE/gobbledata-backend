// GA4 Routes - OAuth flow and property management
import express from "express";
import { authenticateUser } from "../middleware/auth.middleware.js";
import { ga4Service } from "../services/ga4.service.js";
import {
  supabaseService,
  supabaseAdmin,
} from "../services/supabase.service.js";
import { config } from "../config/index.js";
import {
  checkTrialStatus,
  checkPropertyLimit,
} from "../middleware/subscription.middleware.js";

const router = express.Router();

/**
 * ROUTE 1: Start OAuth flow
 * GET /api/ga4/connect
 */
router.get("/connect", async (req, res) => {
  try {
    const token =
      req.query.token || req.headers.authorization?.replace("Bearer ", "");

    if (!token) {
      return res.status(401).json({ error: "No token provided" });
    }

    const { supabaseAdmin } = await import("../services/supabase.service.js");
    const {
      data: { user },
      error,
    } = await supabaseAdmin.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({ error: "Invalid token" });
    }

    const userId = user.id;
    const authUrl = ga4Service.getAuthUrl(userId);

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
      return res.redirect(`${config.frontendUrls[0]}/dashboard?error=no_code`);
    }

    const tokens = await ga4Service.getTokensFromCode(code);

    if (!tokens.access_token) {
      return res.redirect(`${config.frontendUrls[0]}/dashboard?error=no_token`);
    }

    let properties;
    try {
      properties = await ga4Service.getGA4Properties(tokens.access_token);
    } catch (propertyError) {
      console.error("Error fetching properties:", propertyError.message);
      properties = [];
    }

    if (!properties || properties.length === 0) {
      return res.redirect(
        `${config.frontendUrls[0]}/dashboard?error=no_ga4_properties&message=No GA4 properties found. Please set one up in Google Analytics.`
      );
    }

    const crypto = await import("crypto");
    const tempToken = crypto.randomBytes(32).toString("hex");

    global.tempOAuthData = global.tempOAuthData || {};
    global.tempOAuthData[tempToken] = {
      userId,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: new Date(
        Date.now() + (tokens.expiry_date || 3600000)
      ).toISOString(),
      properties,
      createdAt: Date.now(),
    };

    // Clean up old temp data (older than 10 minutes)
    Object.keys(global.tempOAuthData).forEach((key) => {
      if (Date.now() - global.tempOAuthData[key].createdAt > 10 * 60 * 1000) {
        delete global.tempOAuthData[key];
      }
    });

    res.redirect(
      `${config.frontendUrls[0]}/select-property?token=${tempToken}`
    );
  } catch (error) {
    console.error("Callback error:", error);
    res.redirect(`${config.frontendUrls[0]}/dashboard?error=callback_failed`);
  }
});

/**
 * ROUTE: Get OAuth data from temporary token
 * GET /api/ga4/oauth-data?token=TEMP_TOKEN
 */
router.get("/oauth-data", async (req, res) => {
  try {
    const { token } = req.query;

    if (!token) {
      return res.status(400).json({ error: "Token required" });
    }

    const oauthData = global.tempOAuthData?.[token];

    if (!oauthData) {
      return res.status(404).json({
        error: "Invalid or expired token",
        message: "Session expired. Please reconnect from the dashboard.",
      });
    }

    res.json({
      userId: oauthData.userId,
      accessToken: oauthData.accessToken,
      refreshToken: oauthData.refreshToken,
      expiresAt: oauthData.expiresAt,
      properties: oauthData.properties,
    });
  } catch (error) {
    console.error("OAuth data retrieval error:", error);
    res.status(500).json({ error: "Failed to retrieve OAuth data" });
  }
});

/**
 * ROUTE: Get user's property limit based on subscription
 * GET /api/ga4/property-limit
 */
router.get("/property-limit", authenticateUser, async (req, res) => {
  try {
    const userId = req.user.id;

    const { data: subscription } = await supabaseAdmin
      .from("subscriptions")
      .select("*")
      .eq("user_id", userId)
      .single();

    const planType = subscription?.plan_type || "free";

    const { data: connections } = await supabaseAdmin
      .from("ga4_connections")
      .select("id")
      .eq("user_id", userId)
      .eq("is_active", true);

    const currentCount = connections?.length || 0;

    const limits = {
      free: { limit: 1, name: "Free" },
      pro: { limit: 4, name: "Pro" },
      business: { limit: Infinity, name: "Business" },
    };

    const plan = limits[planType];
    const limit = plan.limit;

    res.json({
      plan: planType,
      planName: plan.name,
      limit: limit === Infinity ? "Unlimited" : limit,
      current: currentCount,
      remaining:
        limit === Infinity ? "Unlimited" : Math.max(0, limit - currentCount),
    });
  } catch (error) {
    console.error("Property limit check error:", error);
    res.status(500).json({ error: "Failed to check property limit" });
  }
});

// Allow CORS preflight for /properties
router.options("/properties", (req, res) => {
  res.status(200).end();
});

/**
 * ROUTE: Get user's connected properties
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
 * ROUTE: Save selected GA4 property connection
 * POST /api/ga4/save-connection
 */
router.post(
  "/save-connection",
  authenticateUser,
  checkTrialStatus,
  checkPropertyLimit,
  async (req, res) => {
    try {
      const userId = req.user.id;
      const { propertyId, propertyName, accessToken, refreshToken, expiresAt } =
        req.body;

      if (!propertyId || !propertyName || !accessToken || !refreshToken) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      const { data, error } = await supabaseAdmin
        .from("ga4_connections")
        .upsert(
          {
            user_id: userId,
            property_id: propertyId,
            property_name: propertyName,
            access_token: accessToken,
            refresh_token: refreshToken,
            token_expires_at: expiresAt,
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
        console.error("Failed to save connection:", error);
        return res.status(500).json({ error: "Failed to save connection" });
      }

      // Send welcome email after first GA4 connection
      const { data: existingConnections } = await supabaseAdmin
        .from("ga4_connections")
        .select("id")
        .eq("user_id", userId)
        .eq("is_active", true);

      const isFirstConnection = existingConnections?.length === 1;

      if (isFirstConnection) {
        console.log(`[GA4] Sending welcome email to user ${userId}`);
        const { sendWelcomeEmail } = await import(
          "../services/email.service.js"
        );

        // Send asynchronously (don't block the response)
        sendWelcomeEmail(userId).catch((err) => {
          console.error("[GA4] Failed to send welcome email:", err);
        });
      }

      res.json({
        success: true,
        connection: data,
        propertyLimit: req.propertyLimit,
      });
    } catch (error) {
      console.error("Save connection error:", error);
      res.status(500).json({ error: "Failed to save connection" });
    }
  }
);

/**
 * ROUTE: Disconnect GA4 property
 * DELETE /api/ga4/disconnect/:connectionId
 */
router.delete(
  "/disconnect/:connectionId",
  authenticateUser,
  async (req, res) => {
    try {
      const { connectionId } = req.params;
      const userId = req.user.id;

      const { error } = await supabaseAdmin
        .from("ga4_connections")
        .update({ is_active: false })
        .eq("id", connectionId)
        .eq("user_id", userId);

      if (error) throw error;

      res.json({ success: true, message: "Property disconnected" });
    } catch (error) {
      console.error("Disconnect error:", error);
      res.status(500).json({ error: "Failed to disconnect property" });
    }
  }
);

export default router;
