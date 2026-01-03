// src/services/scheduler.service.js
import cron from "node-cron";
import { supabaseAdmin } from "./supabase.service.js";
import { sendDailyInsights } from "./email.service.js";
import moment from "moment-timezone";

/**
 * Check if today matches the property's report_days
 */
function shouldSendReportToday(reportDays) {
  const daysMap = {
    0: "Sun",
    1: "Mon",
    2: "Tue",
    3: "Wed",
    4: "Thu",
    5: "Fri",
    6: "Sat",
  };

  const today = daysMap[new Date().getDay()];
  return reportDays.includes(today);
}

/**
 * Get lookback days based on subscription tier
 */
function getLookbackDays(subscriptionTier) {
  const tierLimits = {
    starter: 14,
    growth: 30,
    pro: 60,
    enterprise: 90,
  };
  return tierLimits[subscriptionTier] || 14;
}

/**
 * Check if user should receive report based on frequency and last sent
 */
function shouldSendReport(subscriptionTier, lastEmailSentAt, frequency) {
  // Starter = weekly only
  if (subscriptionTier === "starter" && lastEmailSentAt) {
    const daysSinceLastEmail =
      (Date.now() - new Date(lastEmailSentAt)) / (1000 * 60 * 60 * 24);
    if (daysSinceLastEmail < 7) {
      return false; // Already sent this week
    }
  }

  // All other tiers = daily (or more frequent for Pro/Enterprise)
  return true;
}

/**
 * Process daily insights for a single user
 */
async function processDailyInsightsForUser(userId, runId = null) {
  try {
    console.log(`[Scheduler] Processing user: ${userId}`);

    // Step 1: Get user profile with subscription info
    const { data: userProfile, error: userError } = await supabaseAdmin
      .from("user_profiles")
      .select("*")
      .eq("id", userId)
      .single();

    if (userError || !userProfile) {
      console.log(`[Scheduler] User profile not found: ${userId}`);
      return { userId, success: false, error: "User profile not found" };
    }

    // Step 2: Check subscription status
    if (userProfile.subscription_status !== "active") {
      console.log(`[Scheduler] User ${userId} has inactive subscription`);
      return { userId, success: false, error: "Inactive subscription" };
    }

    // Step 3: Get email preferences
    const { data: emailPref, error: prefError } = await supabaseAdmin
      .from("email_preferences")
      .select("*")
      .eq("user_id", userId)
      .single();

    if (prefError || !emailPref || !emailPref.enabled) {
      console.log(`[Scheduler] Email preferences disabled for user ${userId}`);
      return { userId, success: false, error: "Email preferences disabled" };
    }

    // Step 4: Check if we should send report today (based on report_days)
    const reportDays = emailPref.report_days || [
      "Mon",
      "Tue",
      "Wed",
      "Thu",
      "Fri",
      "Sat",
      "Sun",
    ];
    if (!shouldSendReportToday(reportDays)) {
      console.log(`[Scheduler] Not scheduled for today: ${userId}`);
      return { userId, success: false, error: "Not scheduled for today" };
    }

    // Step 5: Check frequency limits (starter = weekly)
    if (
      !shouldSendReport(
        userProfile.subscription_tier,
        emailPref.last_email_sent_at,
        emailPref.frequency
      )
    ) {
      console.log(`[Scheduler] Frequency limit reached for user ${userId}`);
      return { userId, success: false, error: "Frequency limit reached" };
    }

    // Step 6: Get user's GA4 connection
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

    // Step 7: Check if token needs refresh
    const tokenExpiry = new Date(connection.token_expires_at);
    const now = new Date();

    if (now >= tokenExpiry) {
      console.log(`[Scheduler] Refreshing expired token for user ${userId}`);

      const { ga4Service } = await import("./ga4.service.js");
      const newTokens = await ga4Service.refreshAccessToken(
        connection.refresh_token
      );

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
        console.log(`[Scheduler] Token refreshed`);
      }
    }

    // Step 8: Get lookback days based on subscription tier
    const lookbackDays = getLookbackDays(userProfile.subscription_tier);
    console.log(
      `[Scheduler] Using ${lookbackDays}-day lookback for ${userProfile.subscription_tier} tier`
    );

    // Step 9: Fetch GA4 metrics
    const { ga4Service } = await import("./ga4.service.js");
    const metrics = await ga4Service.fetchMetrics(
      connection.property_id,
      accessToken,
      connection.refresh_token,
      {
        startDate: `${lookbackDays}daysAgo`,
        endDate: "yesterday",
      }
    );

    // If token was refreshed during fetchMetrics, save it
    if (metrics.tokenRefreshed && metrics.newAccessToken) {
      console.log(`[Scheduler] Saving refreshed token for user ${userId}`);

      await supabaseAdmin
        .from("ga4_connections")
        .update({
          access_token: metrics.newAccessToken,
          token_expires_at: new Date(Date.now() + 3600 * 1000).toISOString(), // 1 hour from now
        })
        .eq("id", connection.id);
    }

    if (
      !metrics ||
      !metrics.hasData ||
      !metrics.daily ||
      metrics.daily.length === 0
    ) {
      console.log(`[Scheduler] No metrics data available for user ${userId}`);
      return { userId, success: false, error: "No metrics available" };
    }

    // Step 10: Analyze for anomalies
    const { insightsService } = await import("./insights.service.js");
    const insights = await insightsService.analyzeMetrics(metrics.daily);

    if (!insights || insights.length === 0) {
      console.log(`[Scheduler] No insights generated for user ${userId}`);

      // Check if we should send "no insights yet" email
      const { data: connection, error: connError } = await supabaseAdmin
        .from("ga4_connections")
        .select("created_at")
        .eq("user_id", userId)
        .eq("is_active", true)
        .order("created_at", { ascending: true })
        .limit(1)
        .single();

      if (!connError && connection) {
        const hoursSinceConnection =
          (Date.now() - new Date(connection.created_at)) / (1000 * 60 * 60);
        const lastEmailSent = emailPref.last_email_sent_at;

        // Send "no insights" email if:
        // - More than 24 hours since connection
        // - Haven't sent this email before (or it's been 7+ days)
        if (hoursSinceConnection >= 24) {
          const daysSinceLastEmail = lastEmailSent
            ? (Date.now() - new Date(lastEmailSent)) / (1000 * 60 * 60 * 24)
            : 999;

          if (daysSinceLastEmail >= 7) {
            console.log(
              `[Scheduler] Sending "no insights yet" email to user ${userId}`
            );
            const { sendNoInsightsEmail } = await import("./email.service.js");

            const noInsightsResult = await sendNoInsightsEmail(userId);

            if (noInsightsResult.success) {
              // Log email to user_email_logs table (NEW!)
              const { error: logError } = await supabaseAdmin
                .from("user_email_logs")
                .insert({
                  user_id: userId,
                  email_type: "no_insights",
                  sent_at: new Date().toISOString(),
                  insights_count: 0,
                  cron_job_id: runId, // Link to current cron run
                  email_status: "sent",
                  resend_message_id: noInsightsResult.emailId || null,
                });

              if (logError) {
                console.error(
                  `[Scheduler] Failed to log no-insights email:`,
                  logError
                );
              }

              // Update last email sent timestamp
              await supabaseAdmin
                .from("email_preferences")
                .update({ last_email_sent_at: new Date().toISOString() })
                .eq("user_id", userId);

              console.log(
                `[Scheduler] "No insights" email sent to user ${userId}`
              );
            }
          }
        }
      }

      return { userId, success: false, error: "No insights generated" };
    }

    console.log(
      `[Scheduler] Found ${insights.length} insights for user ${userId}`
    );

    // Step 11: Save insights to database (top 3 only)
    const topInsights = insights.slice(0, 3);

    const { error: saveError } = await supabaseAdmin
      .from("daily_insights")
      .upsert(
        topInsights.map((insight, index) => ({
          user_id: userId,
          ga4_connection_id: connection.id,
          insight_date: insight.date,
          insight_type: "ANOMALY",
          priority: index + 1,
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
          onConflict: "user_id,insight_date,priority",
          ignoreDuplicates: false,
        }
      );

    if (saveError) {
      console.error(`[Scheduler] Error saving insights:`, saveError);
      return { userId, success: false, error: saveError.message };
    }

    console.log(`[Scheduler] Saved ${topInsights.length} insights to database`);

    // Step 12: Send email (pass subscription tier for branding)
    const emailResult = await sendDailyInsights(
      userId,
      topInsights,
      userProfile.subscription_tier
    );

    if (!emailResult.success) {
      console.error(`[Scheduler] Error sending email:`, emailResult.error);
      return { userId, success: false, error: emailResult.error };
    }

    // Step 13: Log email to user_email_logs table (NEW!)
    const { error: logError } = await supabaseAdmin
      .from("user_email_logs")
      .insert({
        user_id: userId,
        email_type: "daily_insights",
        sent_at: new Date().toISOString(),
        insights_count: topInsights.length,
        cron_job_id: runId, // Link to current cron run
        email_status: "sent",
        resend_message_id: emailResult.emailId || null,
      });

    if (logError) {
      console.error(`[Scheduler] Failed to log email:`, logError);
      // Don't fail the entire job, just log the error
    }

    // Step 14: Update last email sent timestamp (existing logic)
    await supabaseAdmin
      .from("email_preferences")
      .update({
        last_email_sent_at: new Date().toISOString(),
      })
      .eq("user_id", userId);

    console.log(`[Scheduler] Successfully processed user ${userId}`);
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
 * Check if we should send email to this user based on their preferred delivery time
 * Uses ±1 hour window for flexibility (e.g., 2 PM preference = send between 1-3 PM)
 */
async function shouldSendEmailNow(userId) {
  try {
    // Fetch user's email preferences
    const { data: prefs, error } = await supabaseAdmin
      .from("email_preferences")
      .select("delivery_time, timezone, enabled")
      .eq("user_id", userId)
      .single();

    if (error || !prefs || !prefs.enabled) {
      console.log(
        `[Scheduler] User ${userId} - email disabled or no preferences`
      );
      return false;
    }

    // Parse user's preferred delivery time (format: "14:00:00")
    const [prefHours, prefMinutes] = prefs.delivery_time.split(":").map(Number);

    // Get current time in user's timezone
    const now = new Date();
    const userTimeString = now.toLocaleString("en-US", {
      timeZone: prefs.timezone,
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
    });

    const [currentHours] = userTimeString.split(":").map(Number);

    // Check if current hour is within ±1 hour of preferred hour
    let hourDiff = Math.abs(currentHours - prefHours);

    // Handle day wraparound (e.g., 23:00 vs 01:00 should be 2 hours, not 22)
    if (hourDiff > 12) {
      hourDiff = 24 - hourDiff;
    }

    const isWithinWindow = hourDiff <= 1;

    console.log(
      `[Scheduler] User ${userId} - Preferred: ${prefHours}:00 ${prefs.timezone}, Current: ${currentHours}:00, Diff: ${hourDiff}h, Send: ${isWithinWindow}`
    );

    return isWithinWindow;
  } catch (error) {
    console.error(
      `[Scheduler] Error checking send time for user ${userId}:`,
      error
    );
    // On error, default to sending (fail-safe)
    return true;
  }
}

/**
 * Process daily insights for all active users
 */

export async function runDailyInsightsJob() {
  console.log("\n==================================================");
  console.log(
    `[Scheduler] Starting daily insights job at ${new Date().toISOString()}`
  );
  console.log("==================================================\n");

  const startTime = Date.now();
  let runId = null;

  try {
    // Create run log entry
    const { data: runLog, error: logError } = await supabaseAdmin
      .from("cron_job_runs")
      .insert({
        status: "running",
        started_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (logError) {
      console.error("[Scheduler] Failed to create run log:", logError);
    } else {
      runId = runLog.id;
      console.log(`[Scheduler] Run ID: ${runId}`);
    }

    // Fetch all users with active email preferences
    const { data: preferences, error } = await supabaseAdmin
      .from("email_preferences")
      .select("user_id")
      .eq("enabled", true);

    if (error) {
      console.error("[Scheduler] Error fetching preferences:", error);
      return { success: false, error: error.message };
    }

    if (!preferences || preferences.length === 0) {
      console.log("[Scheduler] No users with email preferences enabled");
      return { success: true, processedUsers: 0, results: [] };
    }

    console.log(
      `[Scheduler] Found ${preferences.length} user(s) with email enabled\n`
    );

    // Process each user
    // Process each user (filter by preferred delivery time)
    console.log(
      "[Scheduler] Checking which users should receive emails now...\n"
    );

    // Filter users based on their preferred delivery time
    const usersToProcess = [];
    for (const pref of preferences) {
      const shouldSend = await shouldSendEmailNow(pref.user_id);
      if (shouldSend) {
        usersToProcess.push(pref);
      }
    }

    console.log(
      `[Scheduler] ${usersToProcess.length} of ${preferences.length} user(s) are within their delivery time window\n`
    );

    if (usersToProcess.length === 0) {
      console.log("[Scheduler] No users to process at this time");

      // Update run log
      if (runId) {
        const duration = Date.now() - startTime;
        await supabaseAdmin
          .from("cron_job_runs")
          .update({
            status: "success",
            completed_at: new Date().toISOString(),
            users_processed: 0,
            emails_sent: 0,
            insights_found: 0,
            duration_ms: duration,
          })
          .eq("id", runId);
      }

      return {
        success: true,
        processedUsers: 0,
        skippedUsers: preferences.length,
        results: [],
      };
    }

    // Process filtered users
    const results = await Promise.allSettled(
      usersToProcess.map((pref) =>
        processDailyInsightsForUser(pref.user_id, runId)
      )
    );

    // Summarize results
    const summary = {
      total: usersToProcess.length,
      skipped: preferences.length - usersToProcess.length,
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
    console.log(`Skipped (wrong time): ${summary.skipped}`);
    console.log(`Successful: ${summary.successful}`);
    console.log(`Failed: ${summary.failed}`);
    console.log("==================================================\n");

    // Update run log with success
    if (runId) {
      const duration = Date.now() - startTime;
      await supabaseAdmin
        .from("cron_job_runs")
        .update({
          status: "success",
          completed_at: new Date().toISOString(),
          users_processed: summary.total,
          emails_sent: summary.successful,
          insights_found: summary.results
            .filter((r) => r.success)
            .reduce((sum, r) => sum + (r.insightsCount || 0), 0),
          duration_ms: duration,
        })
        .eq("id", runId);

      console.log(`[Scheduler] Run logged (${duration}ms)`);
    }

    return { success: true, ...summary };
  } catch (error) {
    console.error("[Scheduler] Fatal error in daily insights job:", error);

    // Update run log with failure
    if (runId) {
      const duration = Date.now() - startTime;
      await supabaseAdmin
        .from("cron_job_runs")
        .update({
          status: "failed",
          completed_at: new Date().toISOString(),
          errors: { message: error.message, stack: error.stack },
          duration_ms: duration,
        })
        .eq("id", runId);
    }

    return { success: false, error: error.message };
  }
}

/**
 * Start the daily cron job
 * Runs every hour and checks which users need reports
 */
export function startDailySchedule() {
  // Run every hour to check for users needing reports
  const schedule = "0 * * * *"; // Every hour at :00

  cron.schedule(
    schedule,
    async () => {
      console.log(
        `[Scheduler] Hourly check triggered at ${new Date().toISOString()}`
      );
      await runDailyInsightsJob();
    },
    {
      scheduled: true,
      timezone: "UTC", // Run in UTC, user timezones handled in logic
    }
  );

  console.log("Hourly scheduler started (checks every hour for due reports)");
}

/**
 * FOR TESTING: Run the job immediately
 */
export async function runNow() {
  console.log("[Scheduler] Manual trigger - running job now...");
  return await runDailyInsightsJob();
}

/**
 * FOR TESTING: Process insights for current user immediately
 * Bypasses time window checks - sends email right now
 */
export async function runNowForCurrentUser(userId) {
  console.log(`[Scheduler] Manual trigger for user ${userId} - running now...`);

  const startTime = Date.now();

  try {
    // Create run log entry
    const { data: runLog, error: logError } = await supabaseAdmin
      .from("cron_job_runs")
      .insert({
        status: "running",
        started_at: new Date().toISOString(),
      })
      .select()
      .single();

    const runId = runLog?.id || null;

    if (logError) {
      console.error("[Scheduler] Failed to create run log:", logError);
    }

    // Process this specific user
    const result = await processDailyInsightsForUser(userId, runId);

    const duration = Date.now() - startTime;

    // Update run log
    if (runId) {
      await supabaseAdmin
        .from("cron_job_runs")
        .update({
          status: result.success ? "success" : "failed",
          completed_at: new Date().toISOString(),
          users_processed: 1,
          emails_sent: result.success ? 1 : 0,
          insights_found: result.insightsCount || 0,
          duration_ms: duration,
          errors: result.success ? null : { message: result.error },
        })
        .eq("id", runId);
    }

    console.log(`[Scheduler] Manual run completed in ${duration}ms`);
    console.log(`Result:`, result);

    return {
      success: result.success,
      userId,
      result,
      duration,
    };
  } catch (error) {
    console.error(`[Scheduler] Error in manual run:`, error);
    return {
      success: false,
      userId,
      error: error.message,
    };
  }
}
