// Insights Service - Statistical anomaly detection with real rigor
import { config } from "../config/index.js";

// Statistical constants
const Z_SCORE_THRESHOLD = 2.0; // 95% confidence (2 std deviations)
const MIN_DATA_POINTS = 7; // Need at least 1 week for meaningful stats
const TREND_WINDOW = 5; // Days to determine if sustained trend

// Action items library
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
   * MAIN ANALYSIS ENGINE
   * Uses statistical rigor to detect meaningful anomalies
   */
  async analyzeMetrics(dailyData, options = {}) {
    if (!dailyData || dailyData.length < MIN_DATA_POINTS) {
      console.log(`⚠️  Need at least ${MIN_DATA_POINTS} days of data`);
      return [];
    }

    const insights = [];

    // Sort data chronologically
    const sortedData = [...dailyData].sort(
      (a, b) => new Date(a.date) - new Date(b.date)
    );

    // Metrics to analyze
    const metricsToAnalyze = [
      "sessions",
      "totalUsers",
      "conversions",
      "engagementRate",
      "bounceRate",
    ];

    console.log(
      `📊 Analyzing ${sortedData.length} days across ${metricsToAnalyze.length} metrics`
    );

    // For each metric, run full statistical analysis
    for (const metricName of metricsToAnalyze) {
      const metricInsights = this.analyzeMetric(sortedData, metricName);
      insights.push(...metricInsights);
    }

    // Sort by statistical significance (Z-score) then impact
    insights.sort((a, b) => {
      if (Math.abs(b.zScore) !== Math.abs(a.zScore)) {
        return Math.abs(b.zScore) - Math.abs(a.zScore);
      }
      return b.impactScore - a.impactScore;
    });

    // Only return top insights (statistically significant)
    const significantInsights = insights.filter(
      (i) => Math.abs(i.zScore) >= Z_SCORE_THRESHOLD
    );

    console.log(
      `✅ Found ${significantInsights.length} statistically significant insights`
    );

    return significantInsights.slice(0, 5); // Top 5 only
  },

  /**
   * STEP 1: Analyze a single metric with full statistical rigor
   */
  analyzeMetric(sortedData, metricName) {
    const insights = [];

    // Extract metric values
    const values = sortedData.map((d) => d[metricName] || 0);

    // Calculate seasonal baseline (accounts for day-of-week patterns)
    const seasonalBaseline = this.calculateSeasonalBaseline(
      sortedData,
      metricName
    );

    // Calculate standard deviation (measures normal variance)
    const stdDev = this.calculateStandardDeviation(values);

    // Analyze last 3 days for anomalies
    const recentDays = sortedData.slice(-3);

    for (const day of recentDays) {
      const dayOfWeek = new Date(day.date).getDay();
      const currentValue = day[metricName] || 0;
      const expectedValue = seasonalBaseline[dayOfWeek];

      // Calculate Z-score (how many standard deviations from normal)
      const zScore = (currentValue - expectedValue) / stdDev;

      // Only flag if statistically significant (>2 std deviations = 95% confidence)
      if (Math.abs(zScore) >= Z_SCORE_THRESHOLD) {
        // Determine if spike or sustained trend
        const trendType = this.classifyTrend(
          sortedData,
          metricName,
          day.date
        );

        // Calculate percent change
        const percentChange = (currentValue - expectedValue) / expectedValue;

        insights.push({
          date: day.date,
          metric: metricName,
          currentValue: currentValue,
          expectedValue: expectedValue,
          percentChange: percentChange,
          zScore: zScore,
          confidence: this.zScoreToConfidence(zScore),
          trendType: trendType,
          direction: percentChange > 0 ? "up" : "down",
          impactScore: Math.abs(percentChange) * 100,
          headline: this.generateHeadline(
            metricName,
            percentChange,
            trendType,
            zScore
          ),
          explanation: this.generateExplanation(
            metricName,
            currentValue,
            expectedValue,
            percentChange,
            trendType,
            day.date
          ),
          actionItems: this.getActionItems(
            metricName,
            percentChange > 0 ? "up" : "down"
          ),
        });
      }
    }

    return insights;
  },

  /**
   * STEP 2: Calculate seasonal baseline (accounts for day-of-week patterns)
   * Example: Mondays are always 20% higher than Wednesdays
   */
  calculateSeasonalBaseline(sortedData, metricName) {
    const byDayOfWeek = Array(7)
      .fill()
      .map(() => []);

    // Group data by day of week
    for (const day of sortedData) {
      const dayOfWeek = new Date(day.date).getDay();
      byDayOfWeek[dayOfWeek].push(day[metricName] || 0);
    }

    // Calculate average for each day of week
    const baseline = {};
    for (let i = 0; i < 7; i++) {
      if (byDayOfWeek[i].length > 0) {
        const sum = byDayOfWeek[i].reduce((acc, val) => acc + val, 0);
        baseline[i] = sum / byDayOfWeek[i].length;
      } else {
        // Fallback to overall average
        const allValues = sortedData.map((d) => d[metricName] || 0);
        const overallSum = allValues.reduce((acc, val) => acc + val, 0);
        baseline[i] = overallSum / allValues.length;
      }
    }

    return baseline;
  },

  /**
   * STEP 3: Calculate standard deviation (measures normal variance)
   */
  calculateStandardDeviation(values) {
    const mean = values.reduce((acc, val) => acc + val, 0) / values.length;
    const squaredDiffs = values.map((val) => Math.pow(val - mean, 2));
    const variance =
      squaredDiffs.reduce((acc, val) => acc + val, 0) / values.length;
    return Math.sqrt(variance);
  },

  /**
   * STEP 4: Classify if spike or sustained trend
   */
  classifyTrend(sortedData, metricName, targetDate) {
    const targetIndex = sortedData.findIndex((d) => d.date === targetDate);
    if (targetIndex < TREND_WINDOW) return "spike";

    // Look at last N days
    const recentWindow = sortedData.slice(
      targetIndex - TREND_WINDOW + 1,
      targetIndex + 1
    );
    const values = recentWindow.map((d) => d[metricName] || 0);

    // Calculate if consistently trending (using simple linear regression slope)
    const slope = this.calculateSlope(values);

    // If slope is strong and consistent, it's a trend
    return Math.abs(slope) > 0.1 ? "trend" : "spike";
  },

  /**
   * Calculate slope (for trend detection)
   */
  calculateSlope(values) {
    const n = values.length;
    const xValues = Array.from({ length: n }, (_, i) => i);

    const sumX = xValues.reduce((acc, x) => acc + x, 0);
    const sumY = values.reduce((acc, y) => acc + y, 0);
    const sumXY = xValues.reduce((acc, x, i) => acc + x * values[i], 0);
    const sumX2 = xValues.reduce((acc, x) => acc + x * x, 0);

    return (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  },

  /**
   * Convert Z-score to confidence %
   */
  zScoreToConfidence(zScore) {
    const absZ = Math.abs(zScore);
    if (absZ >= 3.0) return 99.7; // 3 sigma
    if (absZ >= 2.5) return 98.8;
    if (absZ >= 2.0) return 95.4; // 2 sigma
    return 90.0;
  },

  /**
   * Generate headline with statistical language
   */
  generateHeadline(metricName, percentChange, trendType, zScore) {
    const humanMetric = this.getHumanMetricName(metricName);
    const percentDisplay = (Math.abs(percentChange) * 100).toFixed(1);
    const direction = percentChange > 0 ? "jumped" : "dropped";
    const confidence = this.zScoreToConfidence(zScore);

    const trendWord = trendType === "trend" ? "trending" : direction;

    return `${humanMetric} ${trendWord} ${percentDisplay}% (${confidence}% confidence)`;
  },

  /**
   * Generate explanation with context
   */
  generateExplanation(
    metricName,
    currentValue,
    expectedValue,
    percentChange,
    trendType,
    date
  ) {
    const humanMetric = this.getHumanMetricName(metricName);
    const direction = percentChange > 0 ? "up" : "down";

    const trendContext =
      trendType === "trend"
        ? "This is a sustained trend over multiple days."
        : "This appears to be a temporary spike.";

    return `${humanMetric} reached ${this.formatMetricValue(
      metricName,
      currentValue
    )} on ${date}, ${direction} from an expected ${this.formatMetricValue(
      metricName,
      expectedValue
    )} (accounting for day-of-week patterns). ${trendContext}`;
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
   * Get action items
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