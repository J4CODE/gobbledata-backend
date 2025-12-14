// src/services/scheduler.service.js
import cron from "node-cron";
import { supabaseAdmin } from "./supabase.service.js";
import { sendDailyInsights } from "./email.service.js";
// ga4Service and insightsService imported dynamically to avoid circular deps

/**
 * Process daily insights for a single user
 * @param {string} userId - User ID to process
 * @returns {Promise<Object>} Result object with success/error
 */
async function processDailyInsightsForUser(userId) {
  try {
    console.log(`[Scheduler] Processing user: ${userId}`);

    // Step 1: Get user's GA4 connection
    const { data: connections, error: connError } = await supabaseAdmin
      .from("ga4_connections")
      .select("*")
      .eq("user_id", userId)
      .eq("is_active", true)
      .limit(1);

    if (connError || !connections || connections.length === 0) {
      console.log(`[Scheduler] No active connection for user ${userId}`);
      return { userId, success: false, error: "No active GA4 connection" };
    }

    const connection = connections[0];
    let accessToken = connection.access_token;

    // Step 2: Check if token needs refresh
    const tokenExpiry = new Date(connection.token_expires_at);
    const now = new Date();

    if (now >= tokenExpiry) {
      console.log(`[Scheduler] Refreshing expired token for user ${userId}`);

      const { ga4Service } = await import("./ga4.service.js");
      const newTokens = await ga4Service.refreshAccessToken(
        connection.refresh_token
      );

      // Update token in database
      const { error: updateError } = await supabaseAdmin
        .from("ga4_connections")
        .update({
          access_token: newTokens.access_token,
          token_expires_at: new Date(newTokens.expiry_date).toISOString(),
        })
        .eq("id", connection.id);

      if (updateError) {
        console.error(`[Scheduler] Failed to update token:`, updateError);
      } else {
        accessToken = newTokens.access_token;
        console.log(`[Scheduler] ✅ Token refreshed`);
      }
    }

    // Step 3: Fetch GA4 metrics
    const { ga4Service } = await import("./ga4.service.js");
    const metrics = await ga4Service.fetchMetrics(
      connection.property_id,
      accessToken,
      {
        startDate: "7daysAgo",
        endDate: "yesterday",
      }
    );

    if (
      !metrics ||
      !metrics.hasData ||
      !metrics.daily ||
      metrics.daily.length === 0
    ) {
      console.log(`[Scheduler] No metrics data available for user ${userId}`);
      return { userId, success: false, error: "No metrics available" };
    }

    // Step 4: Analyze for anomalies (DYNAMIC IMPORT)
    const { insightsService } = await import("./insights.service.js");
    const insights = await insightsService.analyzeMetrics(metrics.daily);

    if (!insights || insights.length === 0) {
      console.log(`[Scheduler] No insights generated for user ${userId}`);
      return { userId, success: false, error: "No insights generated" };
    }

    console.log(
      `[Scheduler] Found ${insights.length} insights for user ${userId}`
    );

    // Step 5: Save insights to database (top 3 only)
    const topInsights = insights.slice(0, 3);

    const { error: saveError } = await supabaseAdmin
      .from("daily_insights")
      .upsert(
        topInsights.map((insight, index) => ({
          user_id: userId,
          ga4_connection_id: connection.id,
          insight_date: insight.date,
          insight_type: "ANOMALY",
          priority: index + 1, // ← Use index so each insight has unique priority
          metric_name: insight.metric,
          metric_value: insight.currentValue,
          baseline_value: insight.baseline,
          percent_change: insight.percentChange,
          direction: insight.direction,
          headline: insight.headline,
          explanation: insight.explanation,
          action_item: insight.actionItems.join("\n"),
          impact_score: insight.impactScore,
          supporting_data: null,
          email_sent_at: null,
        })),
        {
          onConflict: "user_id,insight_date,priority", // ← Handle duplicates
          ignoreDuplicates: false, // ← Update if exists
        }
      );

    if (saveError) {
      console.error(
        `[Scheduler] Error saving insights for user ${userId}:`,
        saveError
      );
      return { userId, success: false, error: saveError.message };
    }

    console.log(`[Scheduler] Saved ${topInsights.length} insights to database`);

    // Step 6: Send email
    const emailResult = await sendDailyInsights(userId, topInsights);

    if (!emailResult.success) {
      console.error(
        `[Scheduler] Error sending email for user ${userId}:`,
        emailResult.error
      );
      return { userId, success: false, error: emailResult.error };
    }

    console.log(`[Scheduler] ✅ Successfully processed user ${userId}`);
    return {
      userId,
      success: true,
      insightsCount: topInsights.length,
      emailSent: true,
    };
  } catch (error) {
    console.error(`[Scheduler] Error processing user ${userId}:`, error);
    return { userId, success: false, error: error.message };
  }
}

/**
 * Process daily insights for all active users
 * @returns {Promise<Object>} Summary of results
 */
export async function runDailyInsightsJob() {
  console.log("\n==================================================");
  console.log(
    `[Scheduler] Starting daily insights job at ${new Date().toISOString()}`
  );
  console.log("==================================================\n");

  try {
    // Fetch all users with active GA4 connections
    const { data: connections, error } = await supabaseAdmin
      .from("ga4_connections")
      .select("user_id")
      .eq("is_active", true);

    if (error) {
      console.error("[Scheduler] Error fetching active connections:", error);
      return { success: false, error: error.message };
    }

    if (!connections || connections.length === 0) {
      console.log("[Scheduler] No active connections found");
      return { success: true, processedUsers: 0, results: [] };
    }

    console.log(
      `[Scheduler] Found ${connections.length} active user(s) to process\n`
    );

    // Process each user (run in parallel for efficiency)
    const results = await Promise.allSettled(
      connections.map((conn) => processDailyInsightsForUser(conn.user_id))
    );

    // Summarize results
    const summary = {
      total: connections.length,
      successful: results.filter(
        (r) => r.status === "fulfilled" && r.value.success
      ).length,
      failed: results.filter((r) => r.status === "rejected" || !r.value.success)
        .length,
      results: results.map((r) =>
        r.status === "fulfilled" ? r.value : { success: false, error: r.reason }
      ),
    };

    console.log("\n==================================================");
    console.log("[Scheduler] Daily insights job completed");
    console.log(`Total users: ${summary.total}`);
    console.log(`Successful: ${summary.successful}`);
    console.log(`Failed: ${summary.failed}`);
    console.log("==================================================\n");

    return { success: true, ...summary };
  } catch (error) {
    console.error("[Scheduler] Fatal error in daily insights job:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Start the daily cron job
 * Runs every day at 8:00 AM (server timezone)
 * Cron format: second minute hour day month dayOfWeek
 */
export function startDailySchedule() {
  // Run every day at 8:00 AM
  const schedule = "0 8 * * *"; // minute hour day month dayOfWeek

  cron.schedule(
    schedule,
    async () => {
      console.log("[Scheduler] Cron job triggered");
      await runDailyInsightsJob();
    },
    {
      scheduled: true,
      timezone: "America/New_York", // TODO: Make this configurable per user
    }
  );

  console.log("✅ Daily insights scheduler started (runs at 8:00 AM EST)");
}

/**
 * FOR TESTING: Run the job immediately
 */
export async function runNow() {
  console.log("[Scheduler] Manual trigger - running job now...");
  return await runDailyInsightsJob();
}
