/**
 * Business Hours Checker
 * Determines if a client is currently open based on their business hours configuration
 */

class BusinessHoursChecker {
  /**
   * Check if client is currently open
   * @param {Object} client - Client object with business_hours_config
   * @returns {boolean} - True if open, false if closed
   */
  static isOpen(client) {
    if (!client.business_hours_enabled) {
      return true; // Always open if business hours not enabled
    }

    const config = client.business_hours_config;
    if (!config || !config.timezone) {
      return true; // Default to open if no config
    }

    try {
      // Get current time in client's timezone
      const now = new Date();
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: config.timezone,
        weekday: 'long',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });

      const parts = formatter.formatToParts(now);
      const weekday = parts.find(p => p.type === 'weekday').value.toLowerCase();
      const hour = parseInt(parts.find(p => p.type === 'hour').value);
      const minute = parseInt(parts.find(p => p.type === 'minute').value);
      const currentTime = hour * 60 + minute; // Minutes since midnight

      // Check special closures
      if (config.special_closures) {
        const dateStr = now.toISOString().split('T')[0];
        if (config.special_closures.includes(dateStr)) {
          return false;
        }
      }

      // Check regular hours for this day
      const dayHours = config.hours && config.hours[weekday];
      if (!dayHours) {
        return false; // No hours defined for this day = closed
      }

      // Parse open/close times (format: "HH:MM")
      const [openHour, openMin] = dayHours.open.split(':').map(Number);
      const [closeHour, closeMin] = dayHours.close.split(':').map(Number);

      const openTime = openHour * 60 + openMin;
      const closeTime = closeHour * 60 + closeMin;

      return currentTime >= openTime && currentTime < closeTime;
    } catch (err) {
      console.error('Error checking business hours:', err);
      return true; // Default to open on error
    }
  }

  /**
   * Get formatted business hours string for client
   */
  static getHoursString(client) {
    const config = client.business_hours_config;
    if (!config || !config.hours) {
      return 'Please check our website for hours';
    }

    // Simple format: "Monday-Friday 9:00-17:00"
    const days = Object.keys(config.hours);
    if (days.length === 0) {
      return 'Please check our website for hours';
    }

    const firstDay = days[0];
    const hours = config.hours[firstDay];
    return `${hours.open} to ${hours.close}`;
  }
}

module.exports = {BusinessHoursChecker};
