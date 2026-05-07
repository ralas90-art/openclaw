const { supabase } = require('../integrations/supabase/client');

async function seed() {
  console.log('🌱 Seeding demo tenant...');

  const { data, error } = await supabase
    .from('tenants')
    .insert([
      { 
        name: 'Cresca OS Demo', 
        slug: 'cresca-demo',
        settings: { vertical: 'internal' }
      }
    ])
    .select()
    .single();

  if (error) {
    console.error('❌ Failed to seed tenant:', error.message);
  } else {
    console.log(`✅ Demo tenant created: ${data.name} (${data.id})`);
  }
}

seed();
