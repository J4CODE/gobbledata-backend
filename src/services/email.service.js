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
 * Retry helper - attempts email send with exponential backoff
 * @param {Function} emailFunction - The email sending function to retry
 * @param {number} maxRetries - Maximum number of retry attempts (default: 3)
 * @returns {Object} Result from email function
 */
async function retryEmailSend(emailFunction, maxRetries = 3) {
  const delays = [60000, 300000, 900000]; // 1min, 5min, 15min

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await emailFunction();

      // If successful, return immediately
      if (result.success) {
        if (attempt > 1) {
          console.log(`✅ Email succeeded on retry attempt ${attempt}`);
        }
        return result;
      }

      // If failed but not last attempt, wait and retry
      if (attempt < maxRetries) {
        const delay = delays[attempt - 1];
        console.log(
          `⚠️  Email attempt ${attempt} failed. Retrying in ${delay / 1000}s...`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        // Final attempt failed
        console.error(`❌ Email failed after ${maxRetries} attempts`);
        return result;
      }
    } catch (error) {
      console.error(`❌ Email attempt ${attempt} threw error:`, error.message);

      if (attempt < maxRetries) {
        const delay = delays[attempt - 1];
        console.log(`⚠️  Retrying in ${delay / 1000}s...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        return {
          success: false,
          error: error.message,
          attempts: maxRetries,
        };
      }
    }
  }
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
    // Send email via Resend with retry logic
    const emailResult = await retryEmailSend(async () => {
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
        return {
          success: false,
          error: error.message,
        };
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
    });

    // Return the result from retry wrapper
    if (!emailResult.success) {
      throw new Error(
        `Failed to send email after retries: ${emailResult.error}`
      );
    }

    return emailResult;
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

/**
 * Send welcome email after GA4 connection
 * @param {string} userId - User ID from Supabase
 * @returns {Object} Success status and message
 */
export async function sendWelcomeEmail(userId) {
  try {
    // Validate input
    if (!userId) {
      throw new Error("User ID is required");
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

    // Validate email address
    if (!isValidEmail(user.email)) {
      throw new Error("Invalid email address format");
    }

    // Build welcome email HTML
    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="margin: 0; padding: 0; background-color: #f9fafb; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
          <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
            
            <!-- Header -->
            <div style="text-align: center; margin-bottom: 40px;">
              <h1 style="margin: 0; font-size: 32px; color: #1f2937;">🔥 Welcome to GobbleData!</h1>
            </div>

            <!-- Main Content -->
            <div style="background: white; padding: 40px; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
              
              <p style="font-size: 18px; color: #1f2937; margin: 0 0 20px 0;">
                Hey ${userName}! 👋
              </p>

              <p style="font-size: 16px; color: #4b5563; line-height: 1.6; margin: 0 0 20px 0;">
                Great news - your Google Analytics is connected and we're analyzing your data right now.
              </p>

              <p style="font-size: 16px; color: #1f2937; font-weight: bold; margin: 0 0 10px 0;">
                Here's what happens next:
              </p>

              <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
                <p style="margin: 0 0 12px 0; color: #1f2937; font-size: 15px;">
                  <strong>1️⃣</strong> We're pulling 30 days of your GA4 data
                </p>
                <p style="margin: 0 0 12px 0; color: #1f2937; font-size: 15px;">
                  <strong>2️⃣</strong> Our AI is scanning for unusual patterns (spikes, drops, trends)
                </p>
                <p style="margin: 0; color: #1f2937; font-size: 15px;">
                  <strong>3️⃣</strong> You'll get your first insights email within 24 hours
                </p>
              </div>

              <p style="font-size: 16px; color: #1f2937; font-weight: bold; margin: 0 0 10px 0;">
                What you'll receive:
              </p>

              <ul style="color: #4b5563; font-size: 15px; line-height: 1.8; margin: 0 0 20px 0;">
                <li>Top 3 most important changes in your data</li>
                <li>Why they matter</li>
                <li>What to do about them</li>
              </ul>

              <p style="font-size: 15px; color: #6b7280; line-height: 1.6; margin: 0 0 30px 0;">
                No fluff. Just actionable insights, delivered daily at 5 PM EST.
              </p>

              <!-- CTA Button -->
              <div style="text-align: center; margin: 30px 0;">
                <a href="https://app.gobbledata.com" style="display: inline-block; background: #667eea; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px;">
                  View Dashboard
                </a>
              </div>

              <p style="font-size: 14px; color: #6b7280; margin: 30px 0 0 0; border-top: 1px solid #e5e7eb; padding-top: 20px;">
                Questions? Just reply to this email.
              </p>

              <p style="font-size: 14px; color: #6b7280; margin: 10px 0 0 0;">
                - The GobbleData Team 🦃
              </p>

              <p style="font-size: 13px; color: #9ca3af; margin: 20px 0 0 0; font-style: italic;">
                P.S. Check your spam folder tomorrow if you don't see us in your inbox!
              </p>

            </div>

            <!-- Footer -->
            <div style="text-align: center; padding: 30px 20px; color: #9ca3af; font-size: 13px;">
              <p style="margin: 0;">
                © ${new Date().getFullYear()} GobbleData - AI-Powered GA4 Insights
              </p>
            </div>

          </div>
        </body>
      </html>
    `;

    // Send email via Resend with retry logic
    const emailResult = await retryEmailSend(async () => {
      const { data, error } = await resend.emails.send({
        from: "GobbleData Insights <insights@gobbledata.com>",
        to: [user.email],
        subject: "✅ Your GA4 is connected - First insights coming soon!",
        html: htmlContent,
      });

      if (error) {
        console.error("❌ Resend API error (welcome email):", error);
        return {
          success: false,
          error: error.message,
        };
      }

      console.log("✅ Welcome email sent successfully:", {
        emailId: data.id,
        to: user.email,
        timestamp: new Date().toISOString(),
      });

      return {
        success: true,
        message: "Welcome email sent successfully",
        emailId: data.id,
        recipient: user.email,
      };
    });

    // Return the result from retry wrapper
    // Return the result from retry wrapper
    if (!emailResult.success) {
      throw new Error(
        `Failed to send welcome email after retries: ${emailResult.error}`
      );
    }

    // Log welcome email to user_email_logs table (NEW!)
    const { error: logError } = await supabaseAdmin
      .from("user_email_logs")
      .insert({
        user_id: userId,
        email_type: "welcome",
        sent_at: new Date().toISOString(),
        insights_count: 0,
        cron_job_id: null, // Welcome emails aren't triggered by cron
        email_status: "sent",
        resend_message_id: emailResult.emailId || null,
      });

    if (logError) {
      console.error(`❌ Failed to log welcome email:`, logError);
      // Don't fail the entire function, just log the error
    }

    return emailResult;
  } catch (error) {
    console.error("❌ Error sending welcome email:", error);
    return {
      success: false,
      message: error.message,
      error: error,
    };
  }
}

/**
 * Send "no insights yet" email after 24h if no insights generated
 * @param {string} userId - User ID from Supabase
 * @returns {Object} Success status and message
 */
export async function sendNoInsightsEmail(userId) {
  try {
    // Validate input
    if (!userId) {
      throw new Error("User ID is required");
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

    // Validate email address
    if (!isValidEmail(user.email)) {
      throw new Error("Invalid email address format");
    }

    // Build "no insights yet" email HTML
    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="margin: 0; padding: 0; background-color: #f9fafb; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
          <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
            
            <!-- Header -->
            <div style="text-align: center; margin-bottom: 40px;">
              <h1 style="margin: 0; font-size: 32px; color: #1f2937;">⏳ Still Processing...</h1>
            </div>

            <!-- Main Content -->
            <div style="background: white; padding: 40px; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
              
              <p style="font-size: 18px; color: #1f2937; margin: 0 0 20px 0;">
                Hey ${userName}! 👋
              </p>

              <p style="font-size: 16px; color: #4b5563; line-height: 1.6; margin: 0 0 20px 0;">
                We're still crunching your GA4 data. Here's what's happening:
              </p>

              <div style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
                <p style="font-size: 16px; color: #92400e; font-weight: bold; margin: 0 0 10px 0;">
                  Why you haven't received insights yet:
                </p>
                <ul style="color: #92400e; font-size: 15px; line-height: 1.8; margin: 0; padding-left: 20px;">
                  <li>We need at least 100 sessions/day for reliable anomaly detection</li>
                  <li>Your data might be too consistent (no significant changes detected)</li>
                  <li>We're analyzing 30 days of history - this takes time</li>
                </ul>
              </div>

              <p style="font-size: 16px; color: #1f2937; font-weight: bold; margin: 0 0 10px 0;">
                What happens next:
              </p>

              <p style="font-size: 15px; color: #4b5563; line-height: 1.6; margin: 0 0 20px 0;">
                We check every hour for new patterns. If we detect any significant changes in your metrics, you'll get an email immediately.
              </p>

              <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
                <p style="font-size: 16px; color: #1f2937; font-weight: bold; margin: 0 0 10px 0;">
                  In the meantime:
                </p>
                <ul style="color: #4b5563; font-size: 15px; line-height: 1.8; margin: 0; padding-left: 20px;">
                  <li>Make sure your GA4 tracking code is installed</li>
                  <li>Check that you're getting traffic (at least 100 sessions/day)</li>
                  <li>Verify your property is collecting data in Google Analytics</li>
                </ul>
              </div>

              <!-- CTA Button -->
              <div style="text-align: center; margin: 30px 0;">
                <a href="https://app.gobbledata.com/dashboard" style="display: inline-block; background: #667eea; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px;">
                  View Dashboard
                </a>
              </div>

              <p style="font-size: 14px; color: #6b7280; margin: 30px 0 0 0; border-top: 1px solid #e5e7eb; padding-top: 20px;">
                Questions? Just reply to this email.
              </p>

              <p style="font-size: 14px; color: #6b7280; margin: 10px 0 0 0;">
                - The GobbleData Team 🦃
              </p>

            </div>

            <!-- Footer -->
            <div style="text-align: center; padding: 30px 20px; color: #9ca3af; font-size: 13px;">
              <p style="margin: 0;">
                © ${new Date().getFullYear()} GobbleData - AI-Powered GA4 Insights
              </p>
            </div>

          </div>
        </body>
      </html>
    `;

    // Send email via Resend with retry logic
    const emailResult = await retryEmailSend(async () => {
      const { data, error } = await resend.emails.send({
        from: "GobbleData Insights <insights@gobbledata.com>",
        to: [user.email],
        subject:
          "⏳ Your first insights are processing - here's what's happening",
        html: htmlContent,
      });

      if (error) {
        console.error("❌ Resend API error (no insights email):", error);
        return {
          success: false,
          error: error.message,
        };
      }

      console.log("✅ No insights email sent successfully:", {
        emailId: data.id,
        to: user.email,
        timestamp: new Date().toISOString(),
      });

      return {
        success: true,
        message: "No insights email sent successfully",
        emailId: data.id,
        recipient: user.email,
      };
    });

    // Return the result from retry wrapper
    if (!emailResult.success) {
      throw new Error(
        `Failed to send no insights email after retries: ${emailResult.error}`
      );
    }

    return emailResult;
  } catch (error) {
    console.error("❌ Error sending no insights email:", error);
    return {
      success: false,
      message: error.message,
      error: error,
    };
  }
}
