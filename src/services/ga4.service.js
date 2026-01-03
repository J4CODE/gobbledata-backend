// GA4 Service - Handles Google Analytics API OAuth and data fetching
import { google } from "googleapis";
import { config } from "../config/index.js";

// Create OAuth2 client
const oauth2Client = new google.auth.OAuth2(
  config.ga4.clientId,
  config.ga4.clientSecret,
  config.ga4.redirectUri
);

// Scopes we need (read-only access to Analytics)
const SCOPES = [
  "https://www.googleapis.com/auth/analytics.readonly",
  "https://www.googleapis.com/auth/analytics",
];

export const ga4Service = {
  /**
   * Generate Google OAuth URL
   * User will be redirected here to authorize
   */
  getAuthUrl(userId) {
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: "offline", // Gets refresh token
      scope: SCOPES,
      state: userId, // Pass user ID through OAuth flow
      prompt: "consent", // Force consent screen (ensures refresh token)
    });
    return authUrl;
  },

  /**
   * Exchange authorization code for tokens
   */
  async getTokensFromCode(code) {
    try {
      const { tokens } = await oauth2Client.getToken(code);
      return tokens;
    } catch (error) {
      console.error("Error exchanging code for tokens:", error);
      throw new Error("Failed to get tokens from authorization code");
    }
  },

  /**
   * Refresh access token using refresh token
   */
  async refreshAccessToken(refreshToken) {
    try {
      oauth2Client.setCredentials({
        refresh_token: refreshToken,
      });
      const { credentials } = await oauth2Client.refreshAccessToken();
      return credentials;
    } catch (error) {
      console.error("Error refreshing token:", error);
      throw new Error("Failed to refresh access token");
    }
  },

  /**
   * Get user's GA4 properties
   */
  async getGA4Properties(accessToken) {
    try {
      oauth2Client.setCredentials({
        access_token: accessToken,
      });

      const analyticsAdmin = google.analyticsadmin({
        version: "v1beta",
        auth: oauth2Client,
      });

      // List all account summaries (includes properties)
      const response = await analyticsAdmin.accountSummaries.list();

      const properties = [];

      if (response.data.accountSummaries) {
        response.data.accountSummaries.forEach((account) => {
          if (account.propertySummaries) {
            account.propertySummaries.forEach((property) => {
              // Only include GA4 properties (they start with "properties/")
              if (
                property.property &&
                property.property.includes("properties/")
              ) {
                properties.push({
                  propertyId: property.property.replace("properties/", ""),
                  propertyName: property.displayName,
                  accountName: account.displayName,
                });
              }
            });
          }
        });
      }

      return properties;
    } catch (error) {
      console.error("Error fetching GA4 properties:", error);
      throw new Error("Failed to fetch GA4 properties");
    }
  },

  /**
   * Implement fetchMetrics() Function and Fetch GA4 metrics data
   */
  /**
   * Fetch metrics from GA4 Data API
   async fetchMetrics(propertyId, accessToken, refreshToken, options = {}) {
    try {
      const {
        startDate = "7daysAgo",
        endDate = "yesterday",
        metrics = [
          "sessions",
          "totalUsers",
          "conversions",
          "engagementRate",
          "bounceRate",
          "totalRevenue",
        ],
      } = options;

      // DEBUG: Log what we're sending to Google
      console.log("🔍 GA4 API Request Debug:");
      console.log("  Property ID:", propertyId);
      console.log(
        "  Access Token (first 20 chars):",
        accessToken?.substring(0, 20)
      );
      console.log("  Token length:", accessToken?.length);
      console.log("  Date range:", startDate, "to", endDate);

      // Set up OAuth2 client with access token
      oauth2Client.setCredentials({ 
        access_token: accessToken,
        refresh_token: refreshToken 
      });

      // Initialize Analytics Data API
      const analyticsData = google.analyticsdata("v1beta");

      // Run report request
      let response;
      try {
        response = await analyticsData.properties.runReport({
          auth: oauth2Client,
          property: `properties/${propertyId}`,
          requestBody: {
            dateRanges: [
              {
                startDate: startDate,
                endDate: endDate,
              },
            ],
            metrics: metrics.map((name) => ({ name })),
            dimensions: [{ name: "date" }],
            keepEmptyRows: false,
          },
        });
      } catch (error) {
        // If token expired, refresh and retry
        if (error.code === 401 || error.message?.includes('invalid_grant')) {
          console.log("🔄 Access token expired, refreshing...");
          
          const newCredentials = await this.refreshAccessToken(refreshToken);
          
          console.log("✅ Token refreshed successfully");
          
          // Retry the request with new token
          oauth2Client.setCredentials({ 
            access_token: newCredentials.access_token,
            refresh_token: refreshToken 
          });
          
          response = await analyticsData.properties.runReport({
            auth: oauth2Client,
            property: `properties/${propertyId}`,
            requestBody: {
              dateRanges: [
                {
                  startDate: startDate,
                  endDate: endDate,
                },
              ],
              metrics: metrics.map((name) => ({ name })),
              dimensions: [{ name: "date" }],
              keepEmptyRows: false,
            },
          });
          
          // Return new access token so caller can save it
          return {
            ...this._parseResponse(response, propertyId, startDate, endDate),
            newAccessToken: newCredentials.access_token,
            tokenRefreshed: true,
          };
        } else {
          throw error;
        }
      }

      // Parse and return response
      return this._parseResponse(response, propertyId, startDate, endDate);

    } catch (error) {
      console.error("❌ Error fetching GA4 metrics:", error.message);

      // DEBUG: Log the full error from Google
      console.log("🔍 Full error details:");
      console.log("  Error code:", error.code);
      console.log("  Error status:", error.status);
      console.log(
        "  Error response:",
        JSON.stringify(error.response?.data, null, 2)
      );
      console.log("  Error errors:", JSON.stringify(error.errors, null, 2));

      // Handle specific error cases
      if (error.code === 403) {
        throw new Error("Insufficient permissions - check GA4 access");
      }

      throw error;
    }
  },

  /**
   * Helper: Parse GA4 API response
   * @private
   */
  _parseResponse(response, propertyId, startDate, endDate) {
    const { rows, totals, metricHeaders } = response.data;

    if (!rows || rows.length === 0) {
      console.log("⚠️  No data available for this date range");
      return {
        hasData: false,
        propertyId,
        dateRange: { startDate, endDate },
        totals: {},
        daily: [],
      };
    }

    // Parse totals (aggregate metrics)
    const totalMetrics = {};
    if (totals && totals[0]?.metricValues) {
      metricHeaders.forEach((header, index) => {
        const value = totals[0].metricValues[index]?.value;
        totalMetrics[header.name] = parseFloat(value) || 0;
      });
    }

    // Parse daily breakdown
    const dailyData = rows.map((row) => {
      const date = row.dimensionValues[0].value;
      const metrics = {};

      metricHeaders.forEach((header, index) => {
        const value = row.metricValues[index]?.value;
        metrics[header.name] = parseFloat(value) || 0;
      });

      return {
        date: ga4Service.formatDate(date),
        ...metrics,
      };
    });

    console.log(
      `✅ Fetched ${dailyData.length} days of data for property ${propertyId}`
    );

    return {
      hasData: true,
      propertyId,
      dateRange: { startDate, endDate },
      totals: totalMetrics,
      daily: dailyData,
    };
  },

  /* Helper: Format date from YYYYMMDD to YYYY-MM-DD */
  formatDate(dateString) {
    // Input: "20241210" -> Output: "2024-12-10"
    if (dateString.length === 8) {
      return `${dateString.slice(0, 4)}-${dateString.slice(
        4,
        6
      )}-${dateString.slice(6, 8)}`;
    }
    return dateString;
  },
};
