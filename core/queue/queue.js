const { appEmitter } = require('../../lib/events');
const { logEvent } = require('../../lib/logger');

class MemoryQueue {
  constructor() {
    this.jobs = [];
    this.isProcessing = false;
    this.maxRetries = 3;
  }

  async publish(event, data) {
    console.log(`[Queue] Publishing event: ${event}`);
    const job = {
      event,
      data,
      attempts: 0,
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    };
    this.jobs.push(job);
    this.process();
    return job.id;
  }

  async process() {
    if (this.isProcessing || this.jobs.length === 0) return;
    this.isProcessing = true;

    while (this.jobs.length > 0) {
      const job = this.jobs.shift();
      try {
        job.attempts++;
        console.log(`[Queue] Processing job ${job.id} (Attempt ${job.attempts})`);
        
        // Emit for consumption
        // In a real system, this would be handled by a worker
        await appEmitter.emit(job.event, job.data);
        
      } catch (error) {
        console.error(`[Queue] Job ${job.id} failed:`, error.message);
        
        if (job.attempts < this.maxRetries) {
          console.log(`[Queue] Retrying job ${job.id}...`);
          this.jobs.push(job);
        } else {
          await this.deadLetter(job, error);
        }
      }
    }

    this.isProcessing = false;
  }

  async deadLetter(job, error) {
    console.error(`[Queue] Moving job ${job.id} to Dead Letter Queue`);
    appEmitter.emit('queue.dead_letter', {
      job,
      error: error.message,
      tenant_id: job.data?.tenant_id
    });
  }
}

const eventBus = new MemoryQueue();

module.exports = { eventBus };
