const { supabase } = require('../../lib/supabase');

class MemoryGraph {
  async addRelationship(source_id, target_id, type, metadata = {}) {
    console.log(`[MemoryGraph] Relationship: ${source_id} --(${type})--> ${target_id}`);
    
    if (!supabase) return;

    try {
      await supabase.from('operational_relationships').insert([{
        source_id,
        target_id,
        rel_type: type,
        metadata,
        created_at: new Date().toISOString()
      }]);
    } catch (err) {
      console.error('[MemoryGraph] Failed to record relationship:', err.message);
    }
  }

  async getLineage(event_id) {
    // Adjacency list traversal in Supabase (simplified)
    const { data, error } = await supabase
      .from('operational_relationships')
      .select('*')
      .or(`source_id.eq.${event_id},target_id.eq.${event_id}`);
    
    return data || [];
  }
}

module.exports = new MemoryGraph();
