import { db } from '../db/connection';
import { restrictedBusinessCategories } from '../db/schema';

/**
 * Seed restricted and prohibited business categories
 * Based on common payment processor restrictions and Stripe's prohibited/restricted lists
 */
async function seedRestrictedCategories() {
  console.log('🌱 Seeding restricted business categories...');

  const categories = [
    // Prohibited Categories (Cannot operate on platform)
    {
      category_code: 'adult_content',
      category_name: 'Adult Content & Services',
      description: 'Adult entertainment, pornography, escort services',
      risk_level: 'prohibited',
      is_prohibited: true,
    },
    {
      category_code: 'gambling',
      category_name: 'Gambling & Betting',
      description: 'Online casinos, sports betting, lottery services',
      risk_level: 'prohibited',
      is_prohibited: true,
    },
    {
      category_code: 'weapons',
      category_name: 'Weapons & Ammunition',
      description: 'Firearms, ammunition, explosives, weapons accessories',
      risk_level: 'prohibited',
      is_prohibited: true,
    },
    {
      category_code: 'illegal_drugs',
      category_name: 'Illegal Drugs & Paraphernalia',
      description: 'Controlled substances, drug paraphernalia',
      risk_level: 'prohibited',
      is_prohibited: true,
    },
    {
      category_code: 'counterfeit',
      category_name: 'Counterfeit Goods',
      description: 'Fake designer goods, counterfeit currency',
      risk_level: 'prohibited',
      is_prohibited: true,
    },
    {
      category_code: 'money_laundering',
      category_name: 'Money Laundering Services',
      description: 'Shell banks, money transmitter services without license',
      risk_level: 'prohibited',
      is_prohibited: true,
    },

    // High Risk Categories (Allowed with enhanced monitoring)
    {
      category_code: 'cryptocurrency',
      category_name: 'Cryptocurrency Trading',
      description: 'Cryptocurrency exchanges, ICOs, token sales',
      risk_level: 'high',
      is_prohibited: false,
    },
    {
      category_code: 'forex_trading',
      category_name: 'Forex & Binary Options Trading',
      description: 'Foreign exchange trading, binary options',
      risk_level: 'high',
      is_prohibited: false,
    },
    {
      category_code: 'multi_level_marketing',
      category_name: 'Multi-Level Marketing',
      description: 'MLM, network marketing, pyramid-like structures',
      risk_level: 'high',
      is_prohibited: false,
    },
    {
      category_code: 'debt_collection',
      category_name: 'Debt Collection',
      description: 'Debt collection services, credit repair',
      risk_level: 'high',
      is_prohibited: false,
    },
    {
      category_code: 'financial_services',
      category_name: 'Financial Services',
      description: 'Payday loans, check cashing, money transfer services',
      risk_level: 'high',
      is_prohibited: false,
    },
    {
      category_code: 'travel_services',
      category_name: 'Travel & Timeshare Services',
      description: 'Travel packages, timeshares, vacation rentals',
      risk_level: 'high',
      is_prohibited: false,
    },

    // Medium Risk Categories (Standard monitoring)
    {
      category_code: 'subscription_services',
      category_name: 'Subscription Services',
      description: 'Recurring billing subscriptions, memberships',
      risk_level: 'medium',
      is_prohibited: false,
    },
    {
      category_code: 'digital_goods',
      category_name: 'Digital Goods & Software',
      description: 'Software, digital downloads, online courses',
      risk_level: 'medium',
      is_prohibited: false,
    },
    {
      category_code: 'consulting',
      category_name: 'Consulting & Professional Services',
      description: 'Business consulting, professional advice',
      risk_level: 'medium',
      is_prohibited: false,
    },
    {
      category_code: 'health_wellness',
      category_name: 'Health & Wellness',
      description: 'Supplements, health products, wellness coaching',
      risk_level: 'medium',
      is_prohibited: false,
    },
    {
      category_code: 'event_ticketing',
      category_name: 'Event Ticketing',
      description: 'Ticket sales, event management',
      risk_level: 'medium',
      is_prohibited: false,
    },

    // Low Risk Categories (Minimal monitoring)
    {
      category_code: 'general_services',
      category_name: 'General Services',
      description: 'General task-based services, errands',
      risk_level: 'low',
      is_prohibited: false,
    },
    {
      category_code: 'creative_services',
      category_name: 'Creative Services',
      description: 'Design, writing, photography, art',
      risk_level: 'low',
      is_prohibited: false,
    },
    {
      category_code: 'technology',
      category_name: 'Technology Services',
      description: 'Web development, app development, IT support',
      risk_level: 'low',
      is_prohibited: false,
    },
    {
      category_code: 'education',
      category_name: 'Education & Tutoring',
      description: 'Tutoring, teaching, educational content',
      risk_level: 'low',
      is_prohibited: false,
    },
    {
      category_code: 'home_services',
      category_name: 'Home Services',
      description: 'Cleaning, repairs, maintenance, lawn care',
      risk_level: 'low',
      is_prohibited: false,
    },
    {
      category_code: 'retail',
      category_name: 'Retail & E-commerce',
      description: 'Physical goods sales, merchandise',
      risk_level: 'low',
      is_prohibited: false,
    },
  ];

  try {
    for (const category of categories) {
      try {
        await db
          .insert(restrictedBusinessCategories)
          .values(category)
          .onConflictDoNothing(); // Skip if already exists

        console.log(`  ✅ Added: ${category.category_name} (${category.risk_level})`);
      } catch (error) {
        // Likely a duplicate, which is fine
        console.log(`  ⏭️  Skipped: ${category.category_name} (already exists)`);
      }
    }

    console.log('✅ Restricted business categories seeded successfully');
  } catch (error) {
    console.error('❌ Error seeding restricted categories:', error);
    throw error;
  }
}

// Run if called directly
if (require.main === module) {
  seedRestrictedCategories()
    .then(() => {
      console.log('✅ Seed completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Seed failed:', error);
      process.exit(1);
    });
}

export { seedRestrictedCategories };
