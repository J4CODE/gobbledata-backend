// Supabase client - connects to your database
import { createClient } from "@supabase/supabase-js";
import { config } from "../config/index.js";

// Admin client (can bypass RLS for backend operations)
export const supabaseAdmin = createClient(
  config.supabase.url,
  config.supabase.serviceRoleKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

// Regular client (respects RLS)
export const supabase = createClient(
  config.supabase.url,
  config.supabase.anonKey
);

// Helper functions
export const supabaseService = {
  // Get user profile
  async getUserProfile(userId) {
    const { data, error } = await supabaseAdmin
      .from("user_profiles")
      .select("*")
      .eq("id", userId)
      .single();

    if (error) throw error;
    return data;
  },

  // Create user profile (called after signup)
  async createUserProfile(userId, profileData = {}) {
    const { data, error } = await supabaseAdmin
      .from("user_profiles")
      .insert({
        id: userId,
        ...profileData,
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  // Get user's GA4 connections
  async getGA4Connections(userId) {
    const { data, error } = await supabaseAdmin
      .from("ga4_connections")
      .select("*")
      .eq("user_id", userId)
      .eq("is_active", true);

    if (error) throw error;
    return data;
  },

  /**
   * Save daily insights to database
   * @param {string} userId - User ID
   * @param {array} insights - Array of insight objects
   * @returns {object} Save results
   */
  async saveInsights(userId, connectionId, insights) {
    try {
      if (!insights || insights.length === 0) {
        return { saved: 0, insights: [] };
      }

      // Take top 3 insights only
      const topThree = insights.slice(0, 3);

      // Prepare insights for database
      const insightsToSave = topThree.map((insight, index) => ({
        user_id: userId,
        ga4_connection_id: connectionId, // ← ADDED
        insight_date: new Date().toISOString().split("T")[0],
        insight_type: this.determineInsightType(insight),
        priority: index + 1,
        metric_name: insight.metric,
        metric_value: insight.currentValue, // ← FIXED
        baseline_value: insight.baseline,
        percent_change: insight.percentChange,
        direction: insight.direction, // ← ADDED
        headline: insight.headline,
        explanation: insight.explanation,
        action_item: insight.actionItems.join("\n"),
        impact_score: insight.impactScore,
        supporting_data: {
          date: insight.date,
          threshold: insight.threshold,
        },
      }));

      // Insert into database
      const { data, error } = await supabaseAdmin
        .from("daily_insights")
        .insert(insightsToSave)
        .select();

      if (error) {
        console.error("Error saving insights:", error);
        throw error;
      }

      console.log(`💾 Saved ${data.length} insights to database`);

      return {
        saved: data.length,
        insights: data,
      };
    } catch (error) {
      console.error("saveInsights error:", error);
      throw error;
    }
  },

  /**
   * Determine insight type based on metric and direction
   */
  determineInsightType(insight) {
    const { metric, direction } = insight;

    // Negative changes = ANOMALY (problems)
    if (metric === "bounceRate" && direction === "increase") return "ANOMALY";
    if (metric === "engagementRate" && direction === "decrease")
      return "ANOMALY";
    if (metric === "sessions" && direction === "decrease") return "ANOMALY";
    if (metric === "conversions" && direction === "decrease") return "ANOMALY";

    // Positive changes = OPPORTUNITY (wins)
    if (metric === "sessions" && direction === "increase") return "OPPORTUNITY";
    if (metric === "conversions" && direction === "increase")
      return "OPPORTUNITY";
    if (metric === "engagementRate" && direction === "increase")
      return "OPPORTUNITY";
    if (metric === "bounceRate" && direction === "decrease")
      return "OPPORTUNITY";

    // Default to TREND
    return "TREND";
  },
};
