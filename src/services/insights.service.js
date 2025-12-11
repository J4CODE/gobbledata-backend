// Insights Service - Anomaly detection and insight generation
import { config } from "../config/index.js";

// Action items library - maps metric + direction to recommended actions
const ACTION_LIBRARY = {
  bounceRate_up: [
    "Check mobile performance using Google PageSpeed Insights",
    "Review traffic sources in GA4 to identify low-quality channels",
    "A/B test landing page design and quiz flow",
  ],
  bounceRate_down: [
    "Document what improved (traffic source, UX change, etc.)",
    "Scale successful traffic channels",
    "Apply learnings to other pages",
  ],
  sessions_up: [
    "Ensure infrastructure can handle traffic spike",
    "Capture leads while traffic is high (pop-ups, CTAs)",
    "Analyze traffic sources to understand what drove growth",
  ],
  sessions_down: [
    "Check if marketing campaigns paused or ads stopped",
    "Review SEO rankings for keyword drops",
    "Investigate technical issues (site down, crawl errors)",
  ],
  totalUsers_up: [
    "Capture new user data (email signups, surveys)",
    "Optimize onboarding flow for first-time visitors",
    "Track where new users came from in GA4",
  ],
  totalUsers_down: [
    "Review marketing spend and campaign performance",
    "Check if competitor launched similar product",
    "Audit site speed and technical issues",
  ],
  engagementRate_up: [
    "Document successful content/features driving engagement",
    "Double down on high-engagement pages",
    "Test similar approaches on other pages",
  ],
  engagementRate_down: [
    "Check for broken features or page errors",
    "Review content quality and relevance",
    "A/B test new CTAs and interactive elements",
  ],
  conversions_up: [
    "Scale what's working (traffic source, offer, CTA)",
    "Capture customer feedback to improve further",
    "Test higher price points or upsells",
  ],
  conversions_down: [
    "Check conversion funnel for drop-off points",
    "Review form fields (too many? confusing?)",
    "Test different offers or CTAs",
  ],
};

export const insightsService = {
  /**
   * Analyze metrics and detect anomalies
   * @param {array} dailyData - Array of daily metrics from GA4
   * @param {object} options - Analysis options
   * @returns {array} Array of detected insights
   */
  async analyzeMetrics(dailyData, options = {}) {
    if (!dailyData || dailyData.length === 0) {
      return [];
    }

    const insights = [];

    // Metrics we care about
    const metricsToAnalyze = [
      { name: "sessions", threshold: config.algorithm.thresholds.sessions },
      { name: "totalUsers", threshold: config.algorithm.thresholds.users },
      {
        name: "conversions",
        threshold: config.algorithm.thresholds.conversions,
      },
      {
        name: "engagementRate",
        threshold: config.algorithm.thresholds.engagementRate,
      },
      { name: "bounceRate", threshold: config.algorithm.thresholds.bounceRate },
    ];

    // Sort data by date (oldest first)
    const sortedData = [...dailyData].sort(
      (a, b) => new Date(a.date) - new Date(b.date)
    );

    // Calculate baselines for each metric (simple average for MVP)
    const baselines = this.calculateBaselines(sortedData);

    // Check each recent day for anomalies
    const recentDays = sortedData.slice(-3); // Last 3 days

    //ADDED THIS DEBUG LOGGING:
    console.log("📊 Baselines calculated:", baselines);
    console.log(
      "📅 Recent days to analyze:",
      recentDays.map((d) => d.date)
    );

    for (const day of recentDays) {
      for (const metric of metricsToAnalyze) {
        const anomaly = this.detectAnomaly(
          day,
          baselines,
          metric.name,
          metric.threshold
        );

        if (anomaly) {
          insights.push(anomaly);
        }
      }
    }

    // Sort by impact score (highest first)
    insights.sort((a, b) => b.impactScore - a.impactScore);

    console.log(`🔍 Detected ${insights.length} potential insights`);

    return insights;
  },

  /**
   * Calculate baseline averages for each metric
   */
  calculateBaselines(sortedData) {
    const baselines = {};
    const metricNames = [
      "sessions",
      "totalUsers",
      "conversions",
      "engagementRate",
      "bounceRate",
    ];

    for (const metricName of metricNames) {
      const values = sortedData.map((day) => day[metricName] || 0);
      const sum = values.reduce((acc, val) => acc + val, 0);
      baselines[metricName] = sum / values.length;
    }

    return baselines;
  },

  /**
   * Detect if a metric is anomalous
   */
  detectAnomaly(day, baselines, metricName, threshold) {
    const currentValue = day[metricName] || 0;
    const baseline = baselines[metricName] || 0;

    // ADD THIS DEBUG LOGGING:
    console.log(
      `  Checking ${metricName} on ${
        day.date
      }: ${currentValue} vs baseline ${baseline.toFixed(
        2
      )} (threshold: ${threshold})`
    );

    // Skip if baseline is zero (can't calculate %)
    if (baseline === 0) return null;

    // Calculate percent change
    const percentChange = (currentValue - baseline) / baseline;

    // ADD THIS:
    if (metricName === "bounceRate" && day.date === "2025-12-10") {
      console.log("🐛 DEBUG bounceRate Dec 10:");
      console.log("  currentValue:", currentValue);
      console.log("  baseline:", baseline);
      console.log("  percentChange:", percentChange);
      console.log("  Math.abs(percentChange):", Math.abs(percentChange));
      console.log("  threshold:", threshold);
      console.log(
        "  Math.abs(percentChange) >= threshold:",
        Math.abs(percentChange) >= threshold
      );
    }

    // Check if exceeds threshold
    const isAnomaly = Math.abs(percentChange) >= threshold;

    if (!isAnomaly) return null;

    // Determine direction
    const direction = percentChange > 0 ? "up" : "down";

    // Calculate impact score (higher % change = higher impact)
    const impactScore = Math.abs(percentChange) * 100;

    // Generate human-readable strings
    const humanMetric = this.getHumanMetricName(metricName);
    const percentDisplay = (Math.abs(percentChange) * 100).toFixed(1);

    return {
      date: day.date,
      metric: metricName,
      currentValue: currentValue,
      baseline: baseline,
      percentChange: percentChange,
      direction: direction,
      impactScore: impactScore,
      threshold: threshold,
      headline: `${humanMetric} ${
        direction === "up" ? "jumped" : "dropped"
      } ${percentDisplay}%`,
      explanation: `${humanMetric} reached ${this.formatMetricValue(
        metricName,
        currentValue
      )} on ${day.date}, ${
        direction === "up" ? "up" : "down"
      } from a baseline of ${this.formatMetricValue(metricName, baseline)}.`,
      actionItems: this.getActionItems(metricName, direction),
    };
  },

  /**
   * Convert metric names to human-readable format
   */
  getHumanMetricName(metricName) {
    const names = {
      sessions: "Sessions",
      totalUsers: "Users",
      conversions: "Conversions",
      engagementRate: "Engagement Rate",
      bounceRate: "Bounce Rate",
      totalRevenue: "Revenue",
    };
    return names[metricName] || metricName;
  },

  /**
   * Format metric values for display
   */
  formatMetricValue(metricName, value) {
    if (metricName.includes("Rate")) {
      return `${(value * 100).toFixed(1)}%`;
    }
    if (metricName === "totalRevenue") {
      return `$${value.toFixed(2)}`;
    }
    return Math.round(value).toString();
  },

  /**
   * Get action items for a metric + direction combo
   */
  getActionItems(metricName, direction) {
    const key = `${metricName}_${direction}`;
    return (
      ACTION_LIBRARY[key] || [
        "Review recent changes that might have caused this shift",
        "Check GA4 for additional context and related metrics",
        "Monitor over next few days to confirm this is a trend",
      ]
    );
  },
};
