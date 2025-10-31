## TWILIO CALL PARAMETERS

These come from the incoming Twilio webhook:

### Call Identification
- `call_sid` - Unique identifier for this call (e.g., "CAe1a1d7a638a9a1bf2a610905da40f881")
- `account_sid` - Your Twilio account SID
- `application_sid` - Twilio application SID

### Phone Numbers
- `caller_phone_number` - Full caller phone number with country code (e.g., "+14168189171")
- `caller_phone_last4` - Last 4 digits of caller's number (e.g., "9171")
- `caller_phone_formatted` - Formatted for display (e.g., "(416) 818-9171")
- `to_phone_number` - The number they called (your clinic number)
- `to_phone_formatted` - Formatted destination number

### Call Metadata
- `call_status` - Current call status (e.g., "ringing", "in-progress")
- `direction` - "inbound" or "outbound"
- `caller_city` - Caller's city (if available from Twilio)
- `caller_state` - Caller's state/province
- `caller_zip` - Caller's ZIP/postal code
- `caller_country` - Caller's country code (e.g., "US", "CA")

---

## CLIENT DATABASE FIELDS

These come from your `clients` table in Supabase:

### Basic Info
- `client_id` - Database ID for this client
- `client_name` - Official business name (e.g., "Humber Veterinary Clinic")
- `office_name` - Display name for the office (may differ from client_name)

### Contact Information
- `office_phone` - Main clinic phone number (e.g., "+18005551234")
- `office_website` - Clinic website URL (e.g., "https://humberveterinary.com")
- `office_hours` - Human-readable hours string (e.g., "Monday-Friday 9am-5pm, Saturday 9am-12")

### Transfer Numbers
- `primary_transfer_number` - Main on-call/emergency number (e.g., "+13654001512")
- `secondary_transfer_number` - Backup transfer number (e.g., "+14165558888")
- `vetwise_phone` - VetWise partner phone number (e.g., "+16479526096")

### Configuration
- `voicemail_enabled` - Boolean: true/false
- `business_hours_enabled` - Boolean: true/false
- `agent_voice` - Voice setting (e.g., "Jessica")
- `agent_temperature` - AI temperature setting (e.g., 0.4)
- `ultravox_agent_id` - UUID of the Ultravox agent template

### Business Hours Config (JSONB object)
- `business_hours_timezone` - Timezone string (e.g., "America/Toronto")
- `business_hours_monday_open` - Opening time (e.g., "09:00")
- `business_hours_monday_close` - Closing time (e.g., "17:00")
- (Similar for tuesday, wednesday, thursday, friday, saturday, sunday)
- `business_hours_special_closures` - Array of special closure dates

### System/Metadata
- `jambonz_account_sid` - Jambonz account identifier
- `created_at` - When client was created (ISO timestamp)
- `updated_at` - Last update timestamp

---

## COMPUTED VALUES

These are calculated at call time:

### Date & Time
- `current_date` - Current date (e.g., "Friday, October 31, 2025")
- `current_time` - Current time in clinic timezone (e.g., "5:02 PM")
- `current_datetime` - Combined date and time (e.g., "Friday, October 31, 2025 at 5:02 PM")
- `day_of_week` - Day name (e.g., "Friday")
- `time_of_day` - "morning", "afternoon", or "evening"

### Business Hours Status
- `clinic_open` - Boolean: true if currently open based on business hours
- `clinic_closed` - Boolean: true if currently closed
- `is_the_clinic_open` - String: "yes" or "no" (for compatibility)
- `hours_until_open` - "Opens in 14 hours" (if currently closed)
- `hours_until_close` - "Closes in 2 hours" (if currently open)
- `next_opening_time` - "Monday at 9:00 AM" (next time clinic opens)

### Agent Configuration
- `agent_name` - Name the AI should use (e.g., "Jessica", "Nora")
- `debug_mode` - Boolean: true/false for verbose logging

---