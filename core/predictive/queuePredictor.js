const { supabase } = require('../../lib/supabase');

class QueuePredictor {
  constructor() {
    this.history = [];
    this.windowSize = 10;
  }

  async predictSaturation(queueName, currentDepth, incomingRate) {
    this.history.push({ depth: currentDepth, rate: incomingRate, time: new Date() });
    if (this.history.length > this.windowSize) this.history.shift();

    // Slope analysis (delta depth / delta time)
    const slope = this.calculateSlope();
    const capacity = 10000;
    const timeToSaturation = slope > 0 ? (capacity - currentDepth) / slope : Infinity;

    const confidence = this.history.length / this.windowSize;
    const isImminent = timeToSaturation < 600; // less than 10 mins

    const prediction = {
      queue: queueName,
      time_to_saturation: timeToSaturation,
      is_imminent: isImminent,
      confidence_score: confidence,
      contributing_signals: { slope, currentDepth, windowSize: this.history.length },
      action: isImminent ? 'preemptive_throttle' : 'monitor'
    };

    await this.logPrediction(prediction);
    return prediction;
  }

  calculateSlope() {
    if (this.history.length < 2) return 0;
    const first = this.history[0];
    const last = this.history[this.history.length - 1];
    const dt = (last.time - first.time) / 1000; // seconds
    return (last.depth - first.depth) / dt;
  }

  async logPrediction(data) {
    if (!supabase) return;
    try {
      await supabase.from('predictive_signals').insert([{
        predictor: 'queue_saturation',
        confidence: data.confidence_score,
        signals: data.contributing_signals,
        action: data.action,
        created_at: new Date().toISOString()
      }]);
    } catch (err) {
      console.error('[Predictor] Failed to log signal:', err.message);
    }
  }
}

module.exports = new QueuePredictor();
