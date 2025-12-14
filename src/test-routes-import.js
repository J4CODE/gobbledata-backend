console.log("Testing route imports...\n");

console.log("1. Importing auth routes...");
import("./routes/auth.routes.js")
  .then(() => console.log("   ✅ Auth routes OK"))
  .catch((err) => console.error("   ❌ Auth routes failed:", err.message));

console.log("2. Importing GA4 routes...");
import("./routes/ga4.routes.js")
  .then(() => console.log("   ✅ GA4 routes OK"))
  .catch((err) => console.error("   ❌ GA4 routes failed:", err.message));

console.log("3. Importing insights routes...");
import("./routes/insights.routes.js")
  .then(() => console.log("   ✅ Insights routes OK"))
  .catch((err) => console.error("   ❌ Insights routes failed:", err.message));

console.log("\nWaiting for imports...");
