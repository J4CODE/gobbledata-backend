// Email Preferences API Routes
// Allows users to view and update their email delivery preferences

import express from 'express';
import { supabaseAdmin } from '../services/supabase.service.js';
import { authenticateUser } from '../middleware/auth.middleware.js';

const router = express.Router();

/**
 * GET /api/email-preferences
 * Fetch the authenticated user's email delivery preferences
 */
router.get('/', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.id;

    // Query email_preferences table for this user
    const { data, error } = await supabaseAdmin
      .from('email_preferences')
      .select('enabled, delivery_time, timezone, frequency, report_days, last_email_sent_at')
      .eq('user_id', userId)
      .single();

    if (error) {
      console.error('❌ Error fetching email preferences:', error);
      return res.status(500).json({ 
        error: 'Failed to fetch preferences',
        details: error.message 
      });
    }

    // If no preferences exist, return defaults
    if (!data) {
      return res.json({
        enabled: true,
        delivery_time: '08:00:00',
        timezone: 'America/New_York',
        frequency: 'daily',
        report_days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
        last_email_sent_at: null
      });
    }

    // Return user's preferences
    res.json(data);

  } catch (error) {
    console.error('❌ Error in GET /api/email-preferences:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      details: error.message 
    });
  }
});

/**
 * PUT /api/email-preferences
 * Update the authenticated user's email delivery preferences
 * 
 * Expected body:
 * {
 *   delivery_time: "14:00:00",  // 24-hour format (required)
 *   timezone: "Europe/London",   // IANA timezone (required)
 *   enabled: true,               // boolean (optional)
 *   frequency: "daily"           // 'daily', 'weekly', 'monthly' (optional)
 * }
 */
router.put('/', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.id;
    const { delivery_time, timezone, enabled, frequency } = req.body;

    // Validation: delivery_time is required
    if (!delivery_time) {
      return res.status(400).json({ 
        error: 'delivery_time is required',
        format: 'HH:MM:SS (e.g., 14:00:00 for 2 PM)'
      });
    }

    // Validation: timezone is required
    if (!timezone) {
      return res.status(400).json({ 
        error: 'timezone is required',
        format: 'IANA timezone (e.g., America/New_York, Europe/London)'
      });
    }

    // Validation: delivery_time format (HH:MM:SS)
    const timeRegex = /^([0-1][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/;
    if (!timeRegex.test(delivery_time)) {
      return res.status(400).json({ 
        error: 'Invalid delivery_time format',
        format: 'Must be HH:MM:SS (e.g., 14:00:00)',
        received: delivery_time
      });
    }

    // Validation: frequency (if provided)
    if (frequency && !['daily', 'weekly', 'monthly'].includes(frequency)) {
      return res.status(400).json({ 
        error: 'Invalid frequency',
        allowed: ['daily', 'weekly', 'monthly'],
        received: frequency
      });
    }

    // Build update object (only include provided fields)
    const updates = {
      delivery_time,
      timezone,
      updated_at: new Date().toISOString()
    };

    if (typeof enabled === 'boolean') updates.enabled = enabled;
    if (frequency) updates.frequency = frequency;

    // Check if user preferences exist
    const { data: existing } = await supabaseAdmin
      .from('email_preferences')
      .select('user_id')
      .eq('user_id', userId)
      .single();

    let result;

    if (existing) {
      // Update existing preferences
      result = await supabaseAdmin
        .from('email_preferences')
        .update(updates)
        .eq('user_id', userId)
        .select()
        .single();
    } else {
      // Create new preferences
      result = await supabaseAdmin
        .from('email_preferences')
        .insert({
          user_id: userId,
          ...updates,
          created_at: new Date().toISOString()
        })
        .select()
        .single();
    }

    if (result.error) {
      console.error('❌ Error updating email preferences:', result.error);
      return res.status(500).json({ 
        error: 'Failed to update preferences',
        details: result.error.message 
      });
    }

    console.log(`✅ Email preferences updated for user ${userId}:`, {
      delivery_time,
      timezone
    });

    res.json({
      success: true,
      message: 'Email preferences updated successfully',
      preferences: result.data
    });

  } catch (error) {
    console.error('❌ Error in PUT /api/email-preferences:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      details: error.message 
    });
  }
});

export default router;
