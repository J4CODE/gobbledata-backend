// Scheduler Routes - Manual trigger for daily insights job
import express from "express";
const router = express.Router();
import { authenticateUser } from "../middleware/auth.middleware.js";

/**
 * ROUTE: Manually trigger daily insights job
 * GET /api/scheduler/run-now
 */
router.get("/run-now", async (req, res) => {
  try {
    console.log("[Manual] Triggering daily insights job...");
    const { runNow } = await import("../services/scheduler.service.js");
    const result = await runNow();
    res.json({
      success: true,
      message: "Daily insights job completed",
      ...result,
    });
  } catch (error) {
    console.error("[Manual] Error running daily job:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// TEST ENDPOINT - Check if scheduler would send email now
router.get("/test-time-check", authenticateUser, async (req, res) => {
  try {
    const userId = req.user.id;
    const { supabaseAdmin } = await import("../services/supabase.service.js");
    const { data: prefs } = await supabaseAdmin
      .from("email_preferences")
      .select("delivery_time, timezone, enabled")
      .eq("user_id", userId)
      .single();

    if (!prefs) return res.json({ error: "No preferences found" });

    const now = new Date();
    const userTime = now.toLocaleString("en-US", {
      timeZone: prefs.timezone,
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
    });

    const [prefHours] = prefs.delivery_time.split(":").map(Number);
    const [currentHours] = userTime.split(":").map(Number);

    let hourDiff = Math.abs(currentHours - prefHours);
    if (hourDiff > 12) hourDiff = 24 - hourDiff;

    res.json({
      yourPreference: `${prefs.delivery_time} ${prefs.timezone}`,
      currentTimeInYourZone: userTime,
      hourDifference: hourDiff,
      wouldSendNow: prefs.enabled && hourDiff <= 1,
      explanation:
        hourDiff <= 1
          ? "✅ Would send now"
          : `⏳ Will send in ~${hourDiff} hours`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// NEW: TEST ENDPOINT - Send test email immediately (bypasses time check)
router.post("/test-email-now", authenticateUser, async (req, res) => {
  try {
    const userId = req.user.id;

    console.log(`[API] Manual email test requested by user ${userId}`);

    const { runNowForCurrentUser } = await import(
      "../services/scheduler.service.js"
    );
    const result = await runNowForCurrentUser(userId);

    if (result.success) {
      res.json({
        success: true,
        message: "✅ Email sent successfully!",
        insightsCount: result.result?.insightsCount || 0,
        duration: result.duration,
        details: result.result,
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error || "Failed to send email",
        details: result.result,
      });
    }
  } catch (error) {
    console.error("Error in test-email-now:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

export default router;
