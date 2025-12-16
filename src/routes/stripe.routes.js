// Stripe subscription routes
import express from "express";
import Stripe from "stripe";
import { supabaseAdmin } from "../services/supabase.service.js";

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

/**
 * Create Stripe checkout session
 * POST /api/stripe/create-checkout
 */
router.post("/create-checkout", async (req, res) => {
  try {
    const { userId, priceId, tier } = req.body;

    if (!userId || !priceId || !tier) {
      return res.status(400).json({
        error: "Missing required fields: userId, priceId, tier",
      });
    }

    // Get user profile
    const { data: user, error: userError } = await supabaseAdmin
      .from("user_profiles")
      .select("*")
      .eq("id", userId)
      .single();

    if (userError || !user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Check if user already has a Stripe customer ID
    let customerId = user.stripe_customer_id;

    if (!customerId) {
      // Create new Stripe customer
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: {
          supabase_user_id: userId,
        },
      });
      customerId = customer.id;

      // Save customer ID to database
      await supabaseAdmin
        .from("user_profiles")
        .update({ stripe_customer_id: customerId })
        .eq("id", userId);
    }

    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ["card"],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: "subscription",
      success_url: `${process.env.FRONTEND_URL}/dashboard?session_id={CHECKOUT_SESSION_ID}&success=true`,
      cancel_url: `${process.env.FRONTEND_URL}/pricing?canceled=true`,
      metadata: {
        supabase_user_id: userId,
        subscription_tier: tier,
      },
    });

    res.json({
      success: true,
      sessionId: session.id,
      url: session.url,
    });
  } catch (error) {
    console.error("❌ Stripe checkout error:", error);
    res.status(500).json({
      error: "Failed to create checkout session",
      message: error.message,
    });
  }
});

/**
 * Get user's current subscription status
 * GET /api/stripe/subscription/:userId
 */
router.get("/subscription/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const { data: user, error } = await supabaseAdmin
      .from("user_profiles")
      .select("subscription_tier, subscription_status, stripe_subscription_id")
      .eq("id", userId)
      .single();

    if (error || !user) {
      return res.status(404).json({ error: "User not found" });
    }

    // If user has a Stripe subscription, get details from Stripe
    let subscriptionDetails = null;
    if (user.stripe_subscription_id) {
      try {
        const subscription = await stripe.subscriptions.retrieve(
          user.stripe_subscription_id
        );
        subscriptionDetails = {
          status: subscription.status,
          current_period_end: subscription.current_period_end,
          cancel_at_period_end: subscription.cancel_at_period_end,
        };
      } catch (stripeError) {
        console.error("Error fetching Stripe subscription:", stripeError);
      }
    }

    res.json({
      success: true,
      tier: user.subscription_tier,
      status: user.subscription_status,
      stripeDetails: subscriptionDetails,
    });
  } catch (error) {
    console.error("❌ Error fetching subscription:", error);
    res.status(500).json({ error: "Failed to fetch subscription" });
  }
});

/**
 * Cancel subscription (at period end)
 * POST /api/stripe/cancel-subscription
 */
router.post("/cancel-subscription", async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: "Missing userId" });
    }

    // Get user's subscription
    const { data: user, error: userError } = await supabaseAdmin
      .from("user_profiles")
      .select("stripe_subscription_id")
      .eq("id", userId)
      .single();

    if (userError || !user || !user.stripe_subscription_id) {
      return res.status(404).json({ error: "No active subscription found" });
    }

    // Cancel at period end (don't cancel immediately)
    const subscription = await stripe.subscriptions.update(
      user.stripe_subscription_id,
      {
        cancel_at_period_end: true,
      }
    );

    res.json({
      success: true,
      message: "Subscription will cancel at period end",
      cancels_at: subscription.current_period_end,
    });
  } catch (error) {
    console.error("❌ Cancel subscription error:", error);
    res.status(500).json({
      error: "Failed to cancel subscription",
      message: error.message,
    });
  }
});

export default router;