// Email service for sending daily GA4 insights via Resend (ES Modules)

import { Resend } from "resend";
import { supabaseAdmin } from "./supabase.service.js";

// Initialize Resend with API key from environment variables
const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * Generate HTML email template with insights
 * @param {Array} insights - Array of top 3 insights
 * @param {string} userName - User's name for personalization
 * @returns {string} HTML email template
 */
function generateEmailTemplate(insights, userName = "there") {
  // Email styles (inline CSS for email client compatibility)
  const styles = {
    container:
      'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9fafb;',
    header:
      "background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 12px 12px 0 0; text-align: center;",
    headerTitle: "margin: 0; font-size: 28px; font-weight: bold;",
    headerSubtitle: "margin: 10px 0 0 0; font-size: 16px; opacity: 0.9;",
    content:
      "background: white; padding: 30px; border-radius: 0 0 12px 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);",
    greeting: "font-size: 18px; color: #1f2937; margin-bottom: 20px;",
    insightCard:
      "background: #f3f4f6; border-left: 4px solid #667eea; padding: 20px; margin-bottom: 20px; border-radius: 8px;",
    insightNumber:
      "color: #667eea; font-size: 14px; font-weight: bold; margin-bottom: 8px;",
    metricName:
      "font-size: 20px; font-weight: bold; color: #1f2937; margin-bottom: 8px;",
    changeText: "font-size: 16px; margin-bottom: 12px;",
    actionTitle:
      "font-size: 14px; font-weight: bold; color: #4b5563; margin-bottom: 8px;",
    actionItems:
      "margin: 0; padding-left: 20px; color: #6b7280; line-height: 1.6;",
    footer:
      "text-align: center; padding: 20px; color: #9ca3af; font-size: 14px;",
    button:
      "display: inline-block; background: #667eea; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin-top: 20px;",
  };

  // Build insight cards HTML
  // Build insight cards HTML
  const insightCards = insights
    .map((insight, index) => {
      // Handle both database format and insights service format
      const metricName = insight.metric_name || insight.metric;
      const metricValue = insight.metric_value || insight.currentValue;
      const baselineValue =
        insight.baseline_value || insight.expectedValue || insight.baseline;
      const percentChange = insight.percent_change || insight.percentChange;
      const direction = insight.direction;

      // Safety check - skip if critical values are missing
      if (!metricValue || !baselineValue || percentChange === undefined) {
        console.warn("Skipping insight with missing data:", insight);
        return "";
      }

      // Parse action items (handle both array and string formats)
      const actionItemsArray = Array.isArray(insight.actionItems)
        ? insight.actionItems
        : (insight.action_item || "").split("\n");

      const actionItems = actionItemsArray
        .filter((item) => item && item.trim())
        .map((item) => `<li style="margin-bottom: 6px;">${item.trim()}</li>`)
        .join("");

      // Determine color based on direction
      const directionColor =
        direction === "up"
          ? "#10b981"
          : direction === "down"
          ? "#ef4444"
          : "#6b7280";

      const directionIcon =
        direction === "up" ? "📈" : direction === "down" ? "📉" : "➡️";

      return `
    <div style="${styles.insightCard}">
      <div style="${styles.insightNumber}">INSIGHT #${index + 1}</div>
      <div style="${styles.metricName}">${directionIcon} ${metricName}</div>
      <div style="${styles.changeText}">
        <span style="color: ${directionColor}; font-weight: bold;">
          ${percentChange > 0 ? "+" : ""}${(percentChange * 100).toFixed(1)}%
        </span>
        <span style="color: #6b7280;">
          (${Number(metricValue).toLocaleString()} vs ${Number(
        baselineValue
      ).toLocaleString()})
        </span>
      </div>
      <div style="${styles.actionTitle}">💡 Recommended Actions:</div>
      <ul style="${styles.actionItems}">
        ${actionItems}
      </ul>
    </div>
  `;
    })
    .join("");

  // Complete HTML email
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Your Daily GA4 Insights</title>
      </head>
      <body style="margin: 0; padding: 0; background-color: #f9fafb;">
        <div style="${styles.container}">
          <!-- Header -->
          <div style="${styles.header}">
            <h1 style="${styles.headerTitle}">🔥 GobbleData</h1>
            <p style="${styles.headerSubtitle}">Your Daily GA4 Insights</p>
          </div>

          <!-- Content -->
          <div style="${styles.content}">
            <p style="${styles.greeting}">
              Hey ${userName}! 👋
            </p>
            <p style="color: #6b7280; margin-bottom: 30px;">
              Here are your top 3 insights from yesterday's Google Analytics data:
            </p>

            <!-- Insights -->
            ${insightCards}

            <!-- CTA Button -->
            <div style="text-align: center; margin-top: 30px;">
              <a href="https://app.gobbledata.com" style="${styles.button}">
                View Full Dashboard
              </a>
            </div>
          </div>

          <!-- Footer -->
          <div style="${styles.footer}">
            <p style="margin: 0 0 10px 0;">
              © ${new Date().getFullYear()} GobbleData - Powered by AI
            </p>
            <p style="margin: 0; font-size: 12px;">
              You're receiving this because you connected your GA4 account.
              <br>
              <a href="https://app.gobbledata.com/settings" style="color: #667eea;">Manage preferences</a>
            </p>
          </div>
        </div>
      </body>
    </html>
  `;
}

/**
 * Validate email address format
 * @param {string} email - Email address to validate
 * @returns {boolean} True if valid
 */
function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Send daily insights email to user
 * @param {string} userId - User ID from Supabase
 * @param {Array} insights - Array of top 3 insights
 * @returns {Object} Success status and message
 */
export async function sendDailyInsights(userId, insights) {
  try {
    // Validate inputs
    if (!userId) {
      throw new Error("User ID is required");
    }

    if (!insights || insights.length === 0) {
      throw new Error("No insights provided");
    }

    // Get user email from Supabase Auth
    const {
      data: { user },
      error: authError,
    } = await supabaseAdmin.auth.admin.getUserById(userId);

    if (authError || !user || !user.email) {
      throw new Error(
        `User not found or has no email: ${
          authError?.message || "Unknown error"
        }`
      );
    }

    // Get display name from user_profiles (optional)
    const { data: profile } = await supabaseAdmin
      .from("user_profiles")
      .select("display_name")
      .eq("id", userId)
      .single();

    const userName = profile?.display_name || user.email.split("@")[0];

    // Validate email address (security check)
    if (!isValidEmail(user.email)) {
      throw new Error("Invalid email address format");
    }

    // Generate HTML email
    const htmlContent = generateEmailTemplate(insights, userName);

    // Send email via Resend
    const { data, error } = await resend.emails.send({
      from: "GobbleData Insights <insights@gobbledata.com>",
      to: [user.email],
      subject: `🔥 Your Daily GA4 Insights - ${new Date().toLocaleDateString(
        "en-US",
        { month: "short", day: "numeric" }
      )}`,
      html: htmlContent,
    });

    if (error) {
      console.error("❌ Resend API error:", error);
      throw new Error(`Failed to send email: ${error.message}`);
    }

    console.log("✅ Email sent successfully:", {
      emailId: data.id,
      to: user.email,
      timestamp: new Date().toISOString(),
    });

    return {
      success: true,
      message: "Email sent successfully",
      emailId: data.id,
      recipient: user.email,
    };
  } catch (error) {
    console.error("❌ Error sending daily insights email:", error);
    return {
      success: false,
      message: error.message,
      error: error,
    };
  }
}

/**
 * Send test email (for development/testing)
 * @param {string} email - Email address to send test to
 * @returns {Object} Success status
 */
export async function sendTestEmail(email) {
  try {
    // Validate email
    if (!isValidEmail(email)) {
      throw new Error("Invalid email address format");
    }

    // Mock insights for testing
    const mockInsights = [
      {
        metric_name: "Sessions",
        direction: "up",
        percent_change: 0.255,
        metric_value: 1250,
        baseline_value: 1000,
        action_item:
          "Increase ad spend on high-performing campaigns\nOptimize landing pages for mobile users\nExpand targeting to similar audiences",
      },
      {
        metric_name: "Bounce Rate",
        direction: "down",
        percent_change: -0.152,
        metric_value: 42.5,
        baseline_value: 50.1,
        action_item:
          "Continue current content strategy\nAnalyze top-performing pages and replicate success\nImprove page load speed for better engagement",
      },
      {
        metric_name: "Conversions",
        direction: "up",
        percent_change: 0.187,
        metric_value: 145,
        baseline_value: 122,
        action_item:
          "Scale successful conversion funnels\nA/B test checkout process improvements\nImplement urgency tactics (limited-time offers)",
      },
    ];

    const htmlContent = generateEmailTemplate(mockInsights, "Test User");

    const { data, error } = await resend.emails.send({
      from: "GobbleData Insights <insights@gobbledata.com>",
      to: [email],
      subject: `🔥 Your Daily GA4 Insights - ${new Date().toLocaleDateString(
        "en-US",
        { month: "short", day: "numeric" }
      )}`,
      html: htmlContent,
    });

    if (error) {
      throw new Error(`Resend error: ${error.message}`);
    }

    console.log("Test email sent:", data.id);
    return { success: true, emailId: data.id };
  } catch (error) {
    console.error("Test email failed:", error);
    return { success: false, error: error.message };
  }
}
