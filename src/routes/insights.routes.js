// Insights routes - fetch user's insights
import express from 'express';
import { authenticateUser } from '../middleware/auth.middleware.js';
import { supabaseAdmin } from '../services/supabase.service.js';

const router = express.Router();

// GET /api/insights/status - Dashboard widget data
router.get('/status', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.id; // Extract user ID from JWT

    // Step 1: Get user's last email from user_email_logs table
    const { data: emailLogs, error: emailError } = await supabaseAdmin
      .from('user_email_logs')
      .select('sent_at, email_type, insights_count')
      .eq('user_id', userId)
      .eq('email_status', 'sent') // Only successfully sent emails
      .order('sent_at', { ascending: false }) // Most recent first
      .limit(1); // Only get the last one

    if (emailError) {
      console.error('Error fetching email logs:', emailError);
      return res.status(500).json({ error: 'Failed to fetch email status' });
    }

    // Step 2: Check if user has any GA4 properties connected
    const { data: properties, error: propError } = await supabaseAdmin
      .from('ga4_connections')
      .select('property_id, property_name, is_active')
      .eq('user_id', userId);

    if (propError) {
      console.error('Error fetching GA4 properties:', propError);
      return res.status(500).json({ error: 'Failed to fetch connection status' });
    }

    const propertiesConnected = properties?.filter(p => p.is_active).length || 0;

    // Step 3: Prepare response
    const lastEmail = emailLogs?.[0] || null;

    res.json({
      lastEmailSent: lastEmail?.sent_at || null, // ISO timestamp or null
      lastEmailType: lastEmail?.email_type || null, // 'daily_insights', 'welcome', 'no_insights'
      lastInsightsCount: lastEmail?.insights_count || 0, // How many insights were in last email
      propertiesConnected, // Number of active GA4 properties
      connectionStatus: propertiesConnected > 0 ? 'connected' : 'disconnected',
    });

  } catch (error) {
    console.error('Insights status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// TODO: Implement insights fetching (Week 1 Day 5-7)
router.get('/today', authenticateUser, (req, res) => {
  res.json({ message: 'Today\'s insights - coming in Day 5-7' });
});

export default router;