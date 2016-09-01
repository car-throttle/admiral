var EventEmitter = require('events');
var ms = require('ms');
var Redlock = require('redlock');

var TWO_MINUTES = ms('2m');

function Queue(opts) {
  if (!opts.client) throw new Error('Missing redis client from opts');

  this.default_wait = opts.default_wait || '10m';
  this.lock_time = ms(opts.lock_time || '5m');
  this.prefix = opts.prefix || 'admiral';

  this.redis = opts.client;
  this.redlock = new Redlock([ this.redis ]);

  this.events = new EventEmitter();
}

/**
 * Manipulation methods
 */

/**
 * ZADD {prefix}:{type} Date.now() {id}
 * SADD {prefix}:list {type}
 */
Queue.prototype.create = function (type, id, callback) {
  this.update(type, id, Date.now(), callback);
};

/**
 * ZSCORE {prefix}:{type} {id} => BOOLEAN
 */
Queue.prototype.exists = function (type, id, callback) {
  this.get(type, id, function (err, score) {
    callback(err, !!score);
  });
};

/**
 * ZSCORE {prefix}:{type} {id} => BOOLEAN
 */
Queue.prototype.get = function (type, id, callback) {
  this.redis.ZSCORE(this.prefix + ':' + type, id, function (err, score) {
    callback(err, score || null);
  });
};

/**
 * ZRANGE {prefix}:{type} 0 -1
 */
Queue.prototype.list = function (type, callback) {
  this.redis.ZRANGE(this.prefix + ':' + type, 0, -1, callback);
};

/* istanbul ignore next */
Queue.prototype.process = function (type, worker_fn) {
  var self = this;
  process.nextTick(function iterateFn() {
    onEachTick.call(self, type, worker_fn, function (err) {
      if (err) self.events.emit('error', err);
      process.nextTick(iterateFn);
    });
  });
};

/**
 * ZREM {prefix}:{type} {id}
 * EVAL if redis.call("ZCARD", KEYS[1]) > 0 then return redis.call("SREM", KEYS[2], ARGV[1]) else return 0 end
 */
Queue.prototype.remove = function (type, id, callback) {
  var multi = this.redis.multi();
  multi.ZREM(this.prefix + ':' + type, id);

  multi.EVAL(
    'if redis.call("ZCARD", KEYS[1]) > 0 then return redis.call("SREM", KEYS[2], ARGV[1]) else return 0 end', 2,
    this.prefix + ':' + type, this.prefix + ':list', type
  );

  multi.exec(function (err) {
    callback(err);
  });
};

/**
 * SMEMBERS {prefix}:list
 * For-Each-Type: ZCARD {prefix}:{type}
 */
Queue.prototype.stats = function (callback) {
  var self = this;

  self.redis.SMEMBERS(this.prefix + ':list', function (err, types) {
    /* istanbul ignore if  */
    if (err) return callback(err);

    var multi = self.redis.multi();
    types.forEach(function (type) {
      multi.ZCARD(self.prefix + ':' + type);
    });

    multi.exec(function (err, results) {
      /* istanbul ignore if  */
      if (err) return callback(err);

      results = results.map(function (count, i) {
        return {
          type: types[i],
          count: count || 0
        };
      });

      callback(null, results);
    });
  });
};

/**
 * ZADD {prefix}:{type} Date.now() {id}
 * SADD {prefix}:list {type}
 */
Queue.prototype.update = function (type, id, timestamp, callback) {
  var multi = this.redis.multi();

  multi.ZADD(this.prefix + ':' + type, timestamp, id);
  multi.SADD(this.prefix + ':list', type); // In case someone calls UPDATE before CREATE

  multi.exec(function (err) {
    callback(err);
  });
};

/**
 * Processing methods
 */

Queue.prototype.on = function () {
  this.events.on.apply(this.events, arguments);
};

/**
 * EACH TICK
 *   1. Read the youngest entry in the sorted set
 *   2. Acquire an exclusive lock
 *   3. Update the timer so that other workers don't sit looping on this (now locked) entry
 *   4. Let the worker do it's thing
 *   5. Unlock it & tick over
 */
var onEachTick = function (type, worker_fn, callback) {
  var key = this.prefix + ':' + type;
  var self = this;

  // Pull item off the SORTED SET where the date is less than NOW and if no item, then loops
  self.redis.ZRANGEBYSCORE(key, 0, Date.now(), 'WITHSCORES', 'LIMIT', '0', '1', function (err, results) {
    /* istanbul ignore if */
    if (err) {
      err.message = 'Failed to fetch member from the ZSET: ' + err.message;
      return callback(err);
    }
    if (!Array.isArray(results) || results.length !== 2) {
      return setTimeout(function () {
        callback();
      }, 1000);
    }

    var job = {
      type: type,
      id: results[0],
      timestamp: results[1]
    };

    /* istanbul ignore if */
    if (!job.id || !job.timestamp) {
      err = new Error('Missing id/timestamp for job: ' + JSON.stringify(job));
      err.message = 'Failed to fetch member: ' + err.message;
      return callback(err);
    }

    self.update(type, job.id, Date.now() + TWO_MINUTES, function (err) {
      /* istanbul ignore if */
      if (err) {
        err.message = 'Failed to update ' + type + ':' + job.id + ': ' + err.message;
        return callback(err);
      }

      self.redlock.lock(key + ':locks:' + job.id, self.lock_time, function (err, lock) {
        /* istanbul ignore if */
        if (err) {
          err.message = 'Failed to lock ' + type + ':' + job.id + ': ' + err.message;
          return callback(err);
        }

        /**
         * EXTEND the amount of time the job is locked for
         * AS PER REDLOCK LIMITATIONS, you must extend the lock whist the lock is acquired
         *   If the lock has expired, you won't be able to extend the lock!
         * Pleasantly wrapped to use the ms library <3
         */
        job.extend = function (offset, done) {
          lock.extend(ms(offset), done);
        };

        var IS_LOCKED = true;
        /**
         * Releasing the lock means other workers "could" pick it up again after self.default_wait has passed
         * Use with CAUTION in your own functions
         */
        job.unlock = function (done) {
          if (!IS_LOCKED) return done();
          lock.unlock(function (err) {
            /* istanbul ignore else */
            if (!err) IS_LOCKED = false;
            done(err);
          });
        };

        worker_fn(job, function (err, offset) {
          /* istanbul ignore if */
          if (err) self.events.emit('job error', err);

          job.unlock(function (err) {
            /* istanbul ignore if */
            if (err) {
              err.message = 'Failed to unlock ' + type + ':' + job.id + ': ' + err.message;
              self.events.emit('error', err);
            }

            self.update(type, job.id, Date.now() + ms(offset || self.default_wait), function (err) {
              if (err) err.message = 'Failed to update the time for ' + type + ':' + job.id + ': ' + err.message;
              callback(err);
            });
          });
        });
      });
    });
  });
};

module.exports = Queue;
