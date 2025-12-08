-- Seed Restricted Business Categories for Risk Management System
-- This script populates the restricted_business_categories table with
-- prohibited and restricted categories based on common payment processor rules

-- ============================================================================
-- Insert restricted business categories
-- ============================================================================

INSERT INTO restricted_business_categories (category_code, category_name, description, risk_level, is_prohibited)
VALUES
  -- PROHIBITED CATEGORIES (Cannot operate on platform)
  ('adult_content', 'Adult Content & Services', 'Adult entertainment, pornography, escort services', 'prohibited', true),
  ('gambling', 'Gambling & Betting', 'Online casinos, sports betting, lottery services', 'prohibited', true),
  ('weapons', 'Weapons & Ammunition', 'Firearms, ammunition, explosives, weapons accessories', 'prohibited', true),
  ('illegal_drugs', 'Illegal Drugs & Paraphernalia', 'Controlled substances, drug paraphernalia', 'prohibited', true),
  ('counterfeit', 'Counterfeit Goods', 'Fake designer goods, counterfeit currency', 'prohibited', true),
  ('money_laundering', 'Money Laundering Services', 'Shell banks, money transmitter services without license', 'prohibited', true),

  -- HIGH RISK CATEGORIES (Allowed with enhanced monitoring)
  ('cryptocurrency', 'Cryptocurrency Trading', 'Cryptocurrency exchanges, ICOs, token sales', 'high', false),
  ('forex_trading', 'Forex & Binary Options Trading', 'Foreign exchange trading, binary options', 'high', false),
  ('multi_level_marketing', 'Multi-Level Marketing', 'MLM, network marketing, pyramid-like structures', 'high', false),
  ('debt_collection', 'Debt Collection', 'Debt collection services, credit repair', 'high', false),
  ('financial_services', 'Financial Services', 'Payday loans, check cashing, money transfer services', 'high', false),
  ('travel_services', 'Travel & Timeshare Services', 'Travel packages, timeshares, vacation rentals', 'high', false),

  -- MEDIUM RISK CATEGORIES (Standard monitoring)
  ('subscription_services', 'Subscription Services', 'Recurring billing subscriptions, memberships', 'medium', false),
  ('digital_goods', 'Digital Goods & Software', 'Software, digital downloads, online courses', 'medium', false),
  ('consulting', 'Consulting & Professional Services', 'Business consulting, professional advice', 'medium', false),
  ('health_wellness', 'Health & Wellness', 'Supplements, health products, wellness coaching', 'medium', false),
  ('event_ticketing', 'Event Ticketing', 'Ticket sales, event management', 'medium', false),

  -- LOW RISK CATEGORIES (Minimal monitoring)
  ('general_services', 'General Services', 'General task-based services, errands', 'low', false),
  ('creative_services', 'Creative Services', 'Design, writing, photography, art', 'low', false),
  ('technology', 'Technology Services', 'Web development, app development, IT support', 'low', false),
  ('education', 'Education & Tutoring', 'Tutoring, teaching, educational content', 'low', false),
  ('home_services', 'Home Services', 'Cleaning, repairs, maintenance, lawn care', 'low', false),
  ('retail', 'Retail & E-commerce', 'Physical goods sales, merchandise', 'low', false)
ON CONFLICT (category_code) DO UPDATE SET
  category_name = EXCLUDED.category_name,
  description = EXCLUDED.description,
  risk_level = EXCLUDED.risk_level,
  is_prohibited = EXCLUDED.is_prohibited,
  updated_at = NOW();

-- ============================================================================
-- Verification
-- ============================================================================

-- Display summary of seeded categories
DO $$
DECLARE
  prohibited_count INTEGER;
  high_risk_count INTEGER;
  medium_risk_count INTEGER;
  low_risk_count INTEGER;
  total_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO prohibited_count FROM restricted_business_categories WHERE is_prohibited = true;
  SELECT COUNT(*) INTO high_risk_count FROM restricted_business_categories WHERE risk_level = 'high' AND is_prohibited = false;
  SELECT COUNT(*) INTO medium_risk_count FROM restricted_business_categories WHERE risk_level = 'medium';
  SELECT COUNT(*) INTO low_risk_count FROM restricted_business_categories WHERE risk_level = 'low';
  SELECT COUNT(*) INTO total_count FROM restricted_business_categories;
  
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Restricted Business Categories Seeded';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Prohibited categories: %', prohibited_count;
  RAISE NOTICE 'High-risk categories: %', high_risk_count;
  RAISE NOTICE 'Medium-risk categories: %', medium_risk_count;
  RAISE NOTICE 'Low-risk categories: %', low_risk_count;
  RAISE NOTICE 'Total categories: %', total_count;
  RAISE NOTICE '========================================';
END $$;
